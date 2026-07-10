import { createBrowserRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ChatLayout } from '@/components/chat/ChatLayout';
import { NoChannelSelected } from '@/components/chat/NoChannelSelected';
import { ChannelPage } from '@/components/chat/ChannelPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <ChatLayout />,
        children: [
          { index: true, element: <NoChannelSelected /> },
          { path: 'channels/:channelId', element: <ChannelPage /> },
        ],
      },
    ],
  },
]);
