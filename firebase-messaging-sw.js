// Service worker for chat push notifications (Firebase Cloud Messaging).
// It must live at the site root so it can show notifications for /chat.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBriW88c6W9_6pc0AFEj0Xs0vPb2hcbJnw',
  authDomain: 'status-chat-12343.firebaseapp.com',
  databaseURL: 'https://status-chat-12343-default-rtdb.firebaseio.com',
  projectId: 'status-chat-12343',
  storageBucket: 'status-chat-12343.firebasestorage.app',
  messagingSenderId: '309117531689',
  appId: '1:309117531689:web:3b35d21f6794f375e6ce38'
});

// Notifications sent with a `notification` payload are shown automatically;
// this just keeps the messaging instance alive in the worker.
firebase.messaging();
