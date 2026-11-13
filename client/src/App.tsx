import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import Layout from "./components/Layout";
import SiteGate from "./components/SiteGate";
import HomePage from "./pages/HomePage";

// الصفحات غير الرئيسية تُحمَّل عند الحاجة لتسريع فتح الصفحة الرئيسية.
const AmenitiesPage = lazy(() => import("./pages/AmenitiesPage"));
const GalleryPage = lazy(() => import("./pages/GalleryPage"));
const VideoPage = lazy(() => import("./pages/VideoPage"));
const BookingPage = lazy(() => import("./pages/BookingPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const GuestPortalPage = lazy(() => import("./pages/GuestPortalPage"));
// لوحة الإدارة: حزمة منفصلة لا يحمّلها زوار الموقع.
const AdminApp = lazy(() => import("./admin/AdminApp"));

export default function App() {
  return (
    <Routes>
      <Route
        path="admin/*"
        element={
          <Suspense fallback={<div className="min-h-dvh bg-jood-beige" aria-busy="true" />}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route
        path="g/:token"
        element={
          <Suspense fallback={<div className="min-h-dvh bg-jood-green-950" aria-busy="true" />}>
            <GuestPortalPage />
          </Suspense>
        }
      />
      <Route
        element={
          <SiteGate>
            <Layout />
          </SiteGate>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="amenities" element={<AmenitiesPage />} />
        <Route path="gallery" element={<GalleryPage />} />
        <Route path="video" element={<VideoPage />} />
        {/* Prices and booking are one page now; old links still work. */}
        <Route path="pricing" element={<Navigate to="/booking" replace />} />
        <Route path="booking" element={<BookingPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
