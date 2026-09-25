import React from 'react';
import logo from '../assets/navair-seal-384.webp';
import './loading.css';
export default function LoadingScreen() {
  return <div className="uncertalytics-loading" role="status" aria-label="Loading Uncertalytics">
    <div className="uncertalytics-loading-brand"><img src={logo} alt="NPSL"/><span>Uncertalytics</span></div>
    <div className="uncertalytics-loading-progress" aria-hidden="true"><span/></div>
  </div>;
}
