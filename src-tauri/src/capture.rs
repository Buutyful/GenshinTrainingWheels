//! System-wide keyboard and mouse capture through Windows Raw Input.
//!
//! Raw Input is used instead of a low-level hook (`SetWindowsHookEx`) on purpose: a hook sits
//! in the input path of every application, can add input lag to the game, and is the technique
//! keyloggers use, so it attracts antivirus heuristics. Raw Input only receives a copy of the
//! events, cannot block or alter them, and never touches the game's process.
//!
//! Devices are registered only while a practice run is active. Events are forwarded to the UI
//! and never written to disk.

use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, RegisterClassW,
    HWND_MESSAGE, MSG, WM_APP, WM_INPUT, WNDCLASSW,
};

const WM_CAPTURE_ON: u32 = WM_APP + 1;
const WM_CAPTURE_OFF: u32 = WM_APP + 2;

const RI_KEY_BREAK: u16 = 0x01;
const RI_KEY_E0: u16 = 0x02;
const KEYBOARD_OVERRUN_MAKE_CODE: u16 = 0xFF;

/// (down flag, up flag, DOM-style button index)
const MOUSE_BUTTONS: [(u16, u16, u8); 5] = [
    (0x0001, 0x0002, 0), // left
    (0x0004, 0x0008, 2), // right
    (0x0010, 0x0020, 1), // middle
    (0x0040, 0x0080, 3), // side back
    (0x0100, 0x0200, 4), // side forward
];

#[derive(Clone, Serialize)]
struct RawPayload {
    /// Set-1 scancode; the UI maps it to a key name.
    sc: u16,
    e0: bool,
    down: bool,
    /// Button index for mouse events, absent for keys.
    mouse: Option<u8>,
    /// Milliseconds since the Unix epoch.
    t: f64,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static WINDOW: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

/// Starts the hidden message-only window that receives input. Nothing is captured yet.
pub fn spawn(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::Builder::new()
        .name("raw-input".into())
        .spawn(|| unsafe { message_loop() })
        .expect("failed to start the input thread");
}

pub fn set_active(on: bool) -> Result<(), String> {
    let hwnd = WINDOW.load(Ordering::Acquire);
    if hwnd.is_null() {
        return Err("the input listener is not ready yet".into());
    }
    let msg = if on { WM_CAPTURE_ON } else { WM_CAPTURE_OFF };
    if unsafe { PostMessageW(hwnd as HWND, msg, 0, 0) } == 0 {
        return Err("could not reach the input listener".into());
    }
    Ok(())
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn emit(payload: RawPayload) {
    if let Some(app) = APP.get() {
        let _ = app.emit("raw-input", payload);
    }
}

unsafe fn message_loop() {
    let class: Vec<u16> = "GenshinTrainingWheelsInput\0".encode_utf16().collect();
    let instance = GetModuleHandleW(null());

    let mut wc: WNDCLASSW = zeroed();
    wc.lpfnWndProc = Some(wndproc);
    wc.hInstance = instance as _;
    wc.lpszClassName = class.as_ptr();
    RegisterClassW(&wc);

    let hwnd = CreateWindowExW(
        0,
        class.as_ptr(),
        class.as_ptr(),
        0,
        0,
        0,
        0,
        0,
        HWND_MESSAGE,
        0 as _,
        instance as _,
        null(),
    );
    if (hwnd as usize) == 0 {
        return;
    }
    WINDOW.store(hwnd as *mut c_void, Ordering::Release);

    let mut msg: MSG = zeroed();
    while GetMessageW(&mut msg, 0 as _, 0, 0) > 0 {
        DispatchMessageW(&msg);
    }
}

/// Registers (or removes) keyboard and mouse as raw input sources for our hidden window.
unsafe fn register(hwnd: HWND, on: bool) {
    let (flags, target) = if on {
        (RIDEV_INPUTSINK, hwnd)
    } else {
        (RIDEV_REMOVE, 0 as HWND)
    };
    let devices = [
        // Generic desktop / keyboard
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: flags,
            hwndTarget: target,
        },
        // Generic desktop / mouse
        RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: flags,
            hwndTarget: target,
        },
    ];
    RegisterRawInputDevices(
        devices.as_ptr(),
        devices.len() as u32,
        size_of::<RAWINPUTDEVICE>() as u32,
    );
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_CAPTURE_ON => {
            register(hwnd, true);
            0
        }
        WM_CAPTURE_OFF => {
            register(hwnd, false);
            0
        }
        WM_INPUT => {
            handle_input(lparam);
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe fn handle_input(lparam: LPARAM) {
    let mut raw: RAWINPUT = zeroed();
    let mut size = size_of::<RAWINPUT>() as u32;
    let read = GetRawInputData(
        lparam as HRAWINPUT,
        RID_INPUT,
        &mut raw as *mut RAWINPUT as *mut c_void,
        &mut size,
        size_of::<RAWINPUTHEADER>() as u32,
    );
    if read == u32::MAX || read == 0 {
        return;
    }
    let t = now_ms();

    if raw.header.dwType == RIM_TYPEKEYBOARD {
        let kb = raw.data.keyboard;
        if kb.MakeCode == 0 || kb.MakeCode == KEYBOARD_OVERRUN_MAKE_CODE {
            return;
        }
        emit(RawPayload {
            sc: kb.MakeCode,
            e0: kb.Flags & RI_KEY_E0 != 0,
            down: kb.Flags & RI_KEY_BREAK == 0,
            mouse: None,
            t,
        });
    } else if raw.header.dwType == RIM_TYPEMOUSE {
        let flags = raw.data.mouse.Anonymous.Anonymous.usButtonFlags;
        if flags == 0 {
            return; // plain movement
        }
        for (down, up, button) in MOUSE_BUTTONS {
            if flags & down != 0 {
                emit(RawPayload {
                    sc: 0,
                    e0: false,
                    down: true,
                    mouse: Some(button),
                    t,
                });
            }
            if flags & up != 0 {
                emit(RawPayload {
                    sc: 0,
                    e0: false,
                    down: false,
                    mouse: Some(button),
                    t,
                });
            }
        }
    }
}
