import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, ToastProvider } from './context.jsx';
import { LanguagePicker, Layout } from './components/Shared.jsx';
import Home from './pages/Home.jsx';
import Listing from './pages/Listing.jsx';
import PostForm from './pages/PostForm.jsx';
import { Login, Register } from './pages/Auth.jsx';
import { Chat, Chats, Favorites, MyListings, Requests } from './pages/Account.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <Routes>
          <Route path="/" element={<LanguagePicker />} />
          <Route path="/:lang" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="listing/:id" element={<Listing />} />
            <Route path="listing/:id/edit" element={<PostForm />} />
            <Route path="post" element={<PostForm />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="mine" element={<MyListings />} />
            <Route path="requests" element={<Requests />} />
            <Route path="chats" element={<Chats />} />
            <Route path="chats/:id" element={<Chat />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
