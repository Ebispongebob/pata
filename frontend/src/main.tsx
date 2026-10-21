import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DraftWindow from './DraftWindow'
import './index.css'
import './logo-animation.css'
import 'vditor/dist/index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('window') === 'draft' ? <DraftWindow /> : <App />}
  </React.StrictMode>,
)
