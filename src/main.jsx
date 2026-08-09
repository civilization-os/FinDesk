import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { hydrateUserData } from './userData.js'
import './styles.css'

hydrateUserData().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
