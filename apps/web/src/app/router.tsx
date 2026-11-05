import { createBrowserRouter } from "react-router";
import { AppLayout } from "@/layouts/AppLayout";
import { AuthLayout } from "@/layouts/AuthLayout";
import { RedirectIfAuthenticated, RequireAuth } from "@/features/auth/RequireAuth";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { DocumentViewerPage } from "@/pages/DocumentViewerPage";
import { ChatPage } from "@/pages/ChatPage";
import { SearchPage } from "@/pages/SearchPage";
import { ComparePage } from "@/pages/ComparePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { InvitePage } from "@/pages/InvitePage";
import { AdminPage } from "@/pages/AdminPage";

export const router = createBrowserRouter([
  {
    element: <RedirectIfAuthenticated />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
        ],
      },
    ],
  },
  {
    element: <AuthLayout />,
    children: [{ path: "/reset-password", element: <ResetPasswordPage /> }],
  },
  // Página pública de convite: funciona logado ou não
  { path: "/invite/:token", element: <InvitePage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/documents", element: <DocumentsPage /> },
          { path: "/collections/:collectionId", element: <DocumentsPage /> },
          { path: "/documents/:id", element: <DocumentViewerPage /> },
          { path: "/chat", element: <ChatPage /> },
          { path: "/chat/:conversationId", element: <ChatPage /> },
          { path: "/search", element: <SearchPage /> },
          { path: "/compare", element: <ComparePage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/admin", element: <AdminPage /> },
          { path: "/admin/:section", element: <AdminPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
