import { mount } from 'svelte';
import App from './App.svelte';
import PresentationView from './views/PresentationView.svelte';
import './app.css';

// The presentation window loads the same page; it only draws what the main window sends it.
const target = document.getElementById('app')!;
if (location.hash === '#presentation') mount(PresentationView, { target });
else mount(App, { target });
