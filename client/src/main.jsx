import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, CompareProvider, ToastProvider } from './context.jsx';
import { LanguagePicker, Layout } from './components/Shared.jsx';
import Home from './pages/Home.jsx';
import Listing from './pages/Listing.jsx';
import PostForm from './pages/PostForm.jsx';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/Auth.jsx';
import { Chat, Chats, Favorites, MyListings, Requests, Settings } from './pages/Account.jsx';
import Compare from './pages/Compare.jsx';
import Admin from './pages/Admin.jsx';
import Support from './pages/Support.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <CompareProvider>
        <Routes>
          <Route path="/" element={<LanguagePicker />} />
          <Route path="/:lang" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="listing/:id" element={<Listing />} />
            <Route path="listing/:id/edit" element={<PostForm />} />
            <Route path="post" element={<PostForm />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="forgot" element={<ForgotPassword />} />
            <Route path="reset" element={<ResetPassword />} />
            <Route path="settings" element={<Settings />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="mine" element={<MyListings />} />
            <Route path="requests" element={<Requests />} />
            <Route path="chats" element={<Chats />} />
            <Route path="chats/:id" element={<Chat />} />
            <Route path="compare" element={<Compare />} />
            <Route path="admin" element={<Admin />} />
            <Route path="support" element={<Support />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </CompareProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
