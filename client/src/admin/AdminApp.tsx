import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAdminApp } from "./PushSetup";
import { AuthProvider, RequireAuth } from "./auth";
import AdminLayout from "./AdminLayout";
import LoginPage from "./pages/LoginPage";
import { Loading } from "./ui";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const BookingsPage = lazy(() => import("./pages/BookingsPage"));
const BookingDetailPage = lazy(() => import("./pages/BookingDetailPage"));
const NewBookingPage = lazy(() => import("./pages/NewBookingPage"));
const ContractPage = lazy(() => import("./pages/ContractPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const GuestsPage = lazy(() => import("./pages/GuestsPage"));
const GuestDetailPage = lazy(() => import("./pages/GuestDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AmenitiesPage = lazy(() => import("./pages/AmenitiesPage"));
const ResourcesPage = lazy(() => import("./pages/ResourcesPage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const DiscountsPage = lazy(() => import("./pages/DiscountsPage"));
const WhatsAppPage = lazy(() => import("./pages/WhatsAppPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));

export default function AdminApp() {
  useAdminApp();
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route
          path="bookings/:id/contract"
          element={
            <RequireAuth>
              <Suspense fallback={<Loading />}>
                <ContractPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="bookings/new" element={<NewBookingPage />} />
          <Route path="bookings/:id" element={<BookingDetailPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="guests" element={<GuestsPage />} />
          <Route path="guests/:id" element={<GuestDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="amenities" element={<AmenitiesPage />} />
          <Route path="resources" element={<ResourcesPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="special-prices" element={<PricingPage key="special" mode="special" />} />
          <Route path="discounts" element={<DiscountsPage />} />
          <Route path="whatsapp" element={<WhatsAppPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
