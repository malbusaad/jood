import { lazy } from "react";
import { Route, Routes } from "react-router";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";

// الصفحات غير الرئيسية تُحمَّل عند الحاجة لتسريع فتح الصفحة الرئيسية.
const AmenitiesPage = lazy(() => import("./pages/AmenitiesPage"));
const GalleryPage = lazy(() => import("./pages/GalleryPage"));
const VideoPage = lazy(() => import("./pages/VideoPage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const BookingPage = lazy(() => import("./pages/BookingPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="amenities" element={<AmenitiesPage />} />
        <Route path="gallery" element={<GalleryPage />} />
        <Route path="video" element={<VideoPage />} />
        <Route path="pricing" element={<PricingPage />} />
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
