import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAyX_q2vP1VSwmyLoQtZtfMPeVctGgYsPM",
  authDomain: "weafrica-ride-703b9.firebaseapp.com",
  projectId: "weafrica-ride-703b9",
  storageBucket: "weafrica-ride-703b9.firebasestorage.app",
  messagingSenderId: "32773864546",
  appId: "1:32773864546:web:7b88b925c25cecd8cf653b",
};

// Initialize Firebase only once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const firebaseAuth = getAuth(app);
export default app;