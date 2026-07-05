// Firebase configuration for GCSEChinese
// Note: These keys are safe to expose publicly for Firebase web apps.
// Security is enforced by Firestore Rules (see Section 8.2 of Project Plan).

const firebaseConfig = {
  apiKey: "AIzaSyAWQLQ1CjjayDUKjdPHXHyysN-aErjv76g",
  authDomain: "dfsnmgcsechinese.firebaseapp.com",
  projectId: "dfsnmgcsechinese",
  storageBucket: "dfsnmgcsechinese.firebasestorage.app",
  messagingSenderId: "825429019577",
  appId: "1:825429019577:web:9981a6aa2065e2c06a0468",
  measurementId: "G-G44D8PPH4J"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

console.log("✅ Firebase initialized. Project ID:", firebaseConfig.projectId);