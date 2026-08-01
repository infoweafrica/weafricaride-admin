"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  Save,
  Globe,
  Shield,
  DollarSign,
  Bell,
  FileText,
  Tag,
  Radio,
  AlertTriangle,
  Car,
  Users,
  MapPin,
  Lock,
  Gift,
  Percent,
  BellRing,
  Phone,
  Wallet,
  CreditCard,
  BarChart3,
  Mail,
  Eye,
  ChevronDown,
  ChevronUp,
  Clock,
  Ban,
  Briefcase,
  Loader2,
  ShieldAlert,
} from "lucide-react";

interface SettingField {
  key: string;
  label: string;
  description: string;
  type: "text" | "number" | "toggle" | "select" | "url" | "email";
  value: string | boolean | number;
  options?: { label: string; value: string }[];
}

interface SettingGroup {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: SettingField[];
}

interface SettingSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  groups: SettingGroup[];
}

const settingsData: SettingSection[] = [
  {
    id: "general", title: "General", icon: Globe,
    groups: [
      {
        title: "App Identity", icon: Globe,
        fields: [
          { key: "app_name", label: "App Name", description: "Display name of the application", type: "text", value: "WeAfrica Ride" },
          { key: "support_email", label: "Support Email", description: "Customer support email", type: "email", value: "support@weafrica.mw" },
          { key: "support_phone", label: "Support Phone", description: "Customer support phone number", type: "text", value: "+265888001234" },
          { key: "default_country", label: "Default Country", description: "Default country for new users", type: "select", value: "mw", options: [{ label: "Malawi", value: "mw" }, { label: "South Africa", value: "za" }, { label: "Kenya", value: "ke" }] },
          { key: "default_currency", label: "Default Currency", description: "Default currency for transactions", type: "select", value: "MWK", options: [{ label: "MWK", value: "MWK" }, { label: "ZAR", value: "ZAR" }, { label: "KES", value: "KES" }, { label: "USD", value: "USD" }] },
          { key: "default_language", label: "Default Language", description: "Default app language", type: "select", value: "en", options: [{ label: "English", value: "en" }, { label: "Chichewa", value: "ny" }, { label: "Swahili", value: "sw" }] },
          { key: "timezone", label: "Time Zone", description: "Default time zone", type: "select", value: "Africa/Blantyre", options: [{ label: "Africa/Blantyre (CAT)", value: "Africa/Blantyre" }, { label: "Africa/Johannesburg", value: "Africa/Johannesburg" }, { label: "Africa/Nairobi", value: "Africa/Nairobi" }] },
        ],
      },
      {
        title: "App Controls", icon: Radio,
        fields: [
          { key: "maintenance_mode", label: "Maintenance Mode", description: "Disable the app for all users", type: "toggle", value: false },
          { key: "force_app_update", label: "Force App Update", description: "Force users to update", type: "toggle", value: false },
          { key: "min_app_version_android", label: "Min Android Version", description: "Minimum required Android version", type: "text", value: "1.0.0" },
          { key: "min_app_version_ios", label: "Min iOS Version", description: "Minimum required iOS version", type: "text", value: "1.0.0" },
          { key: "allow_registration", label: "Allow Registration", description: "Allow new users to sign up", type: "toggle", value: true },
        ],
      },
      {
        title: "Legal Links", icon: FileText,
        fields: [
          { key: "terms_url", label: "Terms & Conditions URL", description: "Link to terms page", type: "url", value: "https://weafrica.mw/terms" },
          { key: "privacy_url", label: "Privacy Policy URL", description: "Link to privacy page", type: "url", value: "https://weafrica.mw/privacy" },
          { key: "about_url", label: "About Page URL", description: "Link to about page", type: "url", value: "https://weafrica.mw/about" },
        ],
      },
    ],
  },
  {
    id: "rider", title: "Rider", icon: Users,
    groups: [
      {
        title: "Payment Methods", icon: Wallet,
        fields: [
          { key: "rider_allow_cash", label: "Cash Payments", description: "Riders can pay with cash", type: "toggle", value: true },
          { key: "rider_allow_wallet", label: "Wallet Payments", description: "Riders can pay with wallet balance", type: "toggle", value: true },
          { key: "rider_allow_card", label: "Card Payments", description: "Riders can pay with cards", type: "toggle", value: false },
          { key: "rider_allow_mobile_money", label: "Mobile Money", description: "Airtel Money, TNM Mpamba", type: "toggle", value: true },
          { key: "rider_allow_promo_codes", label: "Promo Codes", description: "Riders can apply promo codes", type: "toggle", value: true },
        ],
      },
      {
        title: "Ride Features", icon: Car,
        fields: [
          { key: "rider_allow_scheduling", label: "Ride Scheduling", description: "Schedule rides for later", type: "toggle", value: true },
          { key: "rider_allow_multiple_stops", label: "Multiple Stops", description: "Add waypoints to ride", type: "toggle", value: false },
          { key: "rider_allow_cancellation", label: "Ride Cancellation", description: "Riders can cancel rides", type: "toggle", value: true },
          { key: "rider_allow_chat_call", label: "Chat/Call Driver", description: "Contact drivers in-app", type: "toggle", value: true },
          { key: "rider_allow_favorite_locations", label: "Favorite Locations", description: "Save favorite places", type: "toggle", value: true },
        ],
      },
      {
        title: "Rider Limits", icon: Ban,
        fields: [
          { key: "rider_max_cancellation_count", label: "Max Cancellations (Daily)", description: "Max cancellations per rider per day", type: "number", value: "3" },
          { key: "rider_min_ride_fare", label: "Minimum Ride Fare (MWK)", description: "Minimum chargeable fare", type: "number", value: "500" },
          { key: "rider_max_distance_km", label: "Max Ride Distance (km)", description: "Hard limit on ride distance", type: "number", value: "200" },
        ],
      },
      {
        title: "Rider Verification", icon: Shield,
        fields: [
          { key: "rider_phone_verification", label: "Phone Verification", description: "Phone OTP required", type: "toggle", value: true },
          { key: "rider_email_verification", label: "Email Verification", description: "Email verification required", type: "toggle", value: false },
          { key: "rider_id_verification", label: "National ID Verification", description: "Require national ID", type: "toggle", value: false },
        ],
      },
      {
        title: "Safety Features", icon: AlertTriangle,
        fields: [
          { key: "rider_sos_button", label: "SOS Button", description: "Emergency SOS button", type: "toggle", value: true },
          { key: "rider_share_trip", label: "Share Trip Live", description: "Share live trip with contacts", type: "toggle", value: true },
          { key: "rider_emergency_contacts", label: "Emergency Contacts", description: "Add emergency contacts", type: "toggle", value: true },
        ],
      },
    ],
  },
  {
    id: "driver", title: "Driver", icon: Car,
    groups: [
      {
        title: "Driver Registration", icon: Briefcase,
        fields: [
          { key: "driver_license_required", label: "License Upload Required", description: "Must upload valid license", type: "toggle", value: true },
          { key: "driver_vehicle_docs_required", label: "Vehicle Documents Required", description: "Must upload vehicle docs", type: "toggle", value: true },
          { key: "driver_police_clearance_required", label: "Police Clearance Required", description: "Must provide police clearance", type: "toggle", value: false },
          { key: "driver_selfie_verification", label: "Selfie Verification", description: "Verify identity with selfie", type: "toggle", value: false },
          { key: "driver_approval_mode", label: "Approval Mode", description: "How drivers are approved", type: "select", value: "manual", options: [{ label: "Manual Approval", value: "manual" }, { label: "Auto Approval", value: "auto" }] },
        ],
      },
      {
        title: "Driver Controls", icon: Clock,
        fields: [
          { key: "driver_online_timeout_minutes", label: "Online Timeout (min)", description: "Auto-offline after inactivity", type: "number", value: "30" },
          { key: "driver_auto_logout_hours", label: "Auto Logout (hours)", description: "Auto logout after inactivity", type: "number", value: "8" },
          { key: "driver_ride_accept_timeout_sec", label: "Ride Accept Timeout (sec)", description: "Time to accept ride request", type: "number", value: "30" },
          { key: "driver_max_daily_rides", label: "Max Daily Rides", description: "Limit rides per driver per day", type: "number", value: "50" },
          { key: "driver_min_rating", label: "Minimum Rating", description: "Drivers below this get suspended", type: "number", value: "3.5" },
        ],
      },
      {
        title: "Driver Earnings", icon: DollarSign,
        fields: [
          { key: "driver_commission_pct", label: "Commission %", description: "Platform commission on earnings", type: "number", value: "20" },
          { key: "driver_peak_hour_bonus_pct", label: "Peak Hour Bonus %", description: "Extra earnings peak hours", type: "number", value: "15" },
          { key: "driver_referral_bonus_mwk", label: "Referral Bonus (MWK)", description: "Bonus for referring drivers", type: "number", value: "3000" },
          { key: "driver_daily_target_rides", label: "Daily Target (Rides)", description: "Target for bonus eligibility", type: "number", value: "15" },
          { key: "driver_weekly_target_rides", label: "Weekly Target (Rides)", description: "Target for weekly bonus", type: "number", value: "80" },
        ],
      },
      {
        title: "Driver Modes", icon: Car,
        fields: [
          { key: "driver_mode_taxi", label: "Taxi Mode", description: "Standard car rides", type: "toggle", value: true },
          { key: "driver_mode_boda", label: "Motorbike (Boda)", description: "Motorbike rides", type: "toggle", value: false },
          { key: "driver_mode_delivery", label: "Delivery Mode", description: "Package delivery", type: "toggle", value: false },
          { key: "driver_mode_luxury", label: "Luxury Mode", description: "Premium rides", type: "toggle", value: false },
          { key: "driver_mode_shared", label: "Shared Ride", description: "Shared/pooled rides", type: "toggle", value: false },
        ],
      },
      {
        title: "Driver Safety", icon: AlertTriangle,
        fields: [
          { key: "driver_panic_button", label: "Panic Button", description: "Emergency button for drivers", type: "toggle", value: true },
          { key: "driver_route_tracking", label: "Route Tracking", description: "Real-time route tracking", type: "toggle", value: true },
          { key: "driver_voice_recording", label: "Voice Recording", description: "Allow audio recording", type: "toggle", value: false },
          { key: "driver_trip_monitoring", label: "Trip Monitoring", description: "Monitor for unusual activity", type: "toggle", value: true },
        ],
      },
    ],
  },
  {
    id: "finance", title: "Finance", icon: DollarSign,
    groups: [
      {
        title: "Payment Methods", icon: CreditCard,
        fields: [
          { key: "fin_payment_cash", label: "Cash Payment", description: "Enable cash payments", type: "toggle", value: true },
          { key: "fin_payment_mobile_money", label: "Mobile Money", description: "Airtel, Mpamba", type: "toggle", value: true },
          { key: "fin_payment_card", label: "Bank Cards", description: "Debit/credit cards", type: "toggle", value: false },
          { key: "fin_payment_wallet", label: "Wallet Balance", description: "Pay from in-app wallet", type: "toggle", value: true },
          { key: "fin_payment_qr", label: "QR Payments", description: "Scan-to-pay QR codes", type: "toggle", value: false },
        ],
      },
      {
        title: "Currency & Localization", icon: Globe,
        fields: [
          { key: "fin_currency_mwk", label: "Malawi Kwacha (MWK)", description: "Enable MWK", type: "toggle", value: true },
          { key: "fin_currency_zar", label: "South African Rand (ZAR)", description: "Enable ZAR", type: "toggle", value: false },
          { key: "fin_currency_usd", label: "US Dollar (USD)", description: "Enable USD", type: "toggle", value: false },
          { key: "fin_auto_exchange_rates", label: "Auto Exchange Rates", description: "Auto-update exchange rates", type: "toggle", value: false },
        ],
      },
      {
        title: "Commission & Fees", icon: Percent,
        fields: [
          { key: "fin_rider_service_fee_pct", label: "Rider Service Fee %", description: "Fee charged to riders", type: "number", value: "5" },
          { key: "fin_driver_commission_pct", label: "Driver Commission %", description: "Platform commission from driver", type: "number", value: "20" },
          { key: "fin_tax_percentage", label: "Tax %", description: "Tax applied on rides", type: "number", value: "16.5" },
          { key: "fin_surge_pricing", label: "Surge Pricing", description: "Enable dynamic surge pricing", type: "toggle", value: false },
          { key: "fin_max_surge_multiplier", label: "Max Surge Multiplier", description: "Maximum surge multiplier", type: "number", value: "3.0" },
        ],
      },
      {
        title: "Withdrawal Settings", icon: Wallet,
        fields: [
          { key: "fin_min_withdrawal_mwk", label: "Min Withdrawal (MWK)", description: "Minimum withdrawal amount", type: "number", value: "5000" },
          { key: "fin_withdrawal_fee_mwk", label: "Withdrawal Fee (MWK)", description: "Fee per withdrawal", type: "number", value: "200" },
          { key: "fin_auto_payout", label: "Auto Payouts", description: "Auto-process payouts", type: "toggle", value: false },
          { key: "fin_manual_payout_approval", label: "Manual Payout Approval", description: "Require admin approval", type: "toggle", value: true },
          { key: "fin_payout_schedule", label: "Payout Schedule", description: "How often payouts process", type: "select", value: "weekly", options: [{ label: "Daily", value: "daily" }, { label: "Weekly", value: "weekly" }, { label: "Bi-weekly", value: "biweekly" }, { label: "Monthly", value: "monthly" }, { label: "On Demand", value: "on_demand" }] },
        ],
      },
      {
        title: "Wallet Settings", icon: Wallet,
        fields: [
          { key: "fin_wallet_topup", label: "Wallet Top-Up", description: "Allow adding money to wallet", type: "toggle", value: true },
          { key: "fin_wallet_transfer", label: "Wallet Transfer", description: "Allow wallet-to-wallet transfers", type: "toggle", value: false },
          { key: "fin_bonus_credits", label: "Bonus Credits", description: "Allow bonus/credit system", type: "toggle", value: true },
          { key: "fin_refund_to_wallet", label: "Refund to Wallet", description: "Process refunds to wallet", type: "toggle", value: true },
          { key: "fin_wallet_max_balance_mwk", label: "Max Wallet Balance (MWK)", description: "Wallet balance limit", type: "number", value: "500000" },
        ],
      },
    ],
  },
  {
    id: "promo", title: "Promo & Rewards", icon: Gift,
    groups: [
      {
        title: "Promo Codes", icon: Tag,
        fields: [
          { key: "promo_enabled", label: "Promo Codes Enabled", description: "Enable promo code system", type: "toggle", value: true },
          { key: "promo_first_ride_only", label: "First Ride Only", description: "Apply to first ride only", type: "toggle", value: false },
          { key: "promo_default_expiry_days", label: "Default Expiry (Days)", description: "Default validity period", type: "number", value: "30" },
          { key: "promo_max_usage_per_user", label: "Max Usage Per User", description: "Times a user can redeem", type: "number", value: "1" },
          { key: "promo_region_targeting", label: "Region Targeting", description: "Country/city based promos", type: "toggle", value: true },
        ],
      },
      {
        title: "Rewards & Loyalty", icon: Gift,
        fields: [
          { key: "rewards_enabled", label: "Loyalty Points", description: "Enable loyalty program", type: "toggle", value: true },
          { key: "rewards_points_per_ride", label: "Points Per Ride", description: "Points per completed ride", type: "number", value: "10" },
          { key: "rewards_cashback_pct", label: "Cashback %", description: "Cashback on ride fare", type: "number", value: "2" },
          { key: "rewards_ride_streak", label: "Ride Streak Rewards", description: "Bonus for consecutive rides", type: "toggle", value: true },
          { key: "rewards_vip_levels", label: "VIP Levels", description: "Tiered VIP system", type: "toggle", value: false },
          { key: "rewards_referral_bonus_mwk", label: "Referral Reward (MWK)", description: "Bonus for referring riders", type: "number", value: "1000" },
        ],
      },
      {
        title: "Campaigns", icon: BarChart3,
        fields: [
          { key: "campaigns_weekend", label: "Weekend Discounts", description: "Weekend promotions", type: "toggle", value: false },
          { key: "campaigns_holiday", label: "Holiday Campaigns", description: "Holiday promotions", type: "toggle", value: false },
          { key: "campaigns_country", label: "Country Campaigns", description: "Country-specific promotions", type: "toggle", value: true },
          { key: "campaigns_student", label: "Student Discounts", description: "Student discount program", type: "toggle", value: false },
        ],
      },
    ],
  },
  {
    id: "dispatch", title: "Dispatch & Ride", icon: Radio,
    groups: [
      {
        title: "Ride Matching", icon: MapPin,
        fields: [
          { key: "dispatch_nearest_driver", label: "Nearest Driver Logic", description: "Assign nearest driver", type: "toggle", value: true },
          { key: "dispatch_priority_driver", label: "Priority Driver Logic", description: "Prioritize high-rated drivers", type: "toggle", value: false },
          { key: "dispatch_rating_priority", label: "Rating Priority", description: "Prioritize by rating", type: "toggle", value: false },
          { key: "dispatch_search_radius_km", label: "Search Radius (km)", description: "Max search distance", type: "number", value: "10" },
        ],
      },
      {
        title: "Auto Dispatch", icon: Radio,
        fields: [
          { key: "dispatch_auto_assign", label: "Auto Assign Rides", description: "Auto-assign to drivers", type: "toggle", value: false },
          { key: "dispatch_manual_allowed", label: "Manual Dispatch", description: "Admin manual assignment", type: "toggle", value: true },
          { key: "dispatch_queue_management", label: "Ride Queue", description: "Enable ride queuing", type: "toggle", value: true },
          { key: "dispatch_auto_retry_count", label: "Auto Retry Count", description: "Drivers to try before fallback", type: "number", value: "3" },
        ],
      },
      {
        title: "Surge Pricing", icon: DollarSign,
        fields: [
          { key: "surge_time_based", label: "Time-Based Surge", description: "Surge by time of day", type: "toggle", value: false },
          { key: "surge_area_based", label: "Area-Based Surge", description: "Surge by geographic zone", type: "toggle", value: false },
          { key: "surge_weather_based", label: "Weather Surge", description: "Surge during rain/emergency", type: "toggle", value: false },
          { key: "surge_min_multiplier", label: "Min Multiplier", description: "Minimum surge multiplier", type: "number", value: "1.2" },
          { key: "surge_max_multiplier", label: "Max Multiplier", description: "Maximum surge multiplier", type: "number", value: "3.0" },
        ],
      },
      {
        title: "Trip Rules", icon: FileText,
        fields: [
          { key: "trip_waiting_fee_per_min", label: "Waiting Fee/Min (MWK)", description: "Fee when driver waits", type: "number", value: "50" },
          { key: "trip_cancellation_fee_mwk", label: "Cancellation Fee (MWK)", description: "Fee for cancelling", type: "number", value: "500" },
          { key: "trip_free_cancel_minutes", label: "Free Cancel Window (min)", description: "Time for free cancellation", type: "number", value: "5" },
          { key: "trip_night_pricing_mult", label: "Night Pricing Multiplier", description: "Extra charge for night rides", type: "number", value: "1.25" },
          { key: "trip_airport_pricing", label: "Airport Pricing", description: "Special airport trip pricing", type: "toggle", value: false },
        ],
      },
    ],
  },
  {
    id: "notifications", title: "Notifications", icon: Bell,
    groups: [
      {
        title: "Push Notifications", icon: BellRing,
        fields: [
          { key: "push_ride_accepted", label: "Ride Accepted", description: "Notify when driver accepts", type: "toggle", value: true },
          { key: "push_driver_arriving", label: "Driver Arriving", description: "Notify ETA updates", type: "toggle", value: true },
          { key: "push_ride_started", label: "Ride Started", description: "Notify ride begins", type: "toggle", value: true },
          { key: "push_ride_completed", label: "Ride Completed", description: "Notify ride ends", type: "toggle", value: true },
          { key: "push_payment_received", label: "Payment Received", description: "Notify payment processed", type: "toggle", value: true },
          { key: "push_promo_alerts", label: "Promo Alerts", description: "Send promo notifications", type: "toggle", value: true },
          { key: "push_driver_approved", label: "Driver Approved", description: "Notify approval status", type: "toggle", value: true },
          { key: "push_payout_completed", label: "Payout Completed", description: "Notify payout processed", type: "toggle", value: true },
        ],
      },
      {
        title: "SMS Notifications", icon: Phone,
        fields: [
          { key: "sms_otp_enabled", label: "OTP via SMS", description: "Send OTP via SMS", type: "toggle", value: true },
          { key: "sms_ride_alerts", label: "Ride Alerts via SMS", description: "Important ride updates SMS", type: "toggle", value: true },
          { key: "sms_emergency_alerts", label: "Emergency SMS", description: "Send emergency alerts SMS", type: "toggle", value: true },
          { key: "sms_provider", label: "SMS Provider", description: "SMS gateway provider", type: "select", value: "twilio", options: [{ label: "Twilio", value: "twilio" }, { label: "AfricasTalking", value: "africastalking" }, { label: "Infobip", value: "infobip" }] },
        ],
      },
      {
        title: "Email Notifications", icon: Mail,
        fields: [
          { key: "email_receipts", label: "Email Receipts", description: "Send ride receipts", type: "toggle", value: true },
          { key: "email_support_replies", label: "Support Replies", description: "Email support responses", type: "toggle", value: true },
          { key: "email_admin_reports", label: "Admin Reports", description: "Email periodic reports", type: "toggle", value: true },
          { key: "email_promotions", label: "Promo Emails", description: "Send promo emails", type: "toggle", value: false },
        ],
      },
    ],
  },
  {
    id: "safety", title: "Safety & Security", icon: Shield,
    groups: [
      {
        title: "Security", icon: Lock,
        fields: [
          { key: "sec_admin_2fa", label: "2FA for Admins", description: "Two-factor auth required", type: "toggle", value: true },
          { key: "sec_device_management", label: "Device Management", description: "Track user devices", type: "toggle", value: true },
          { key: "sec_login_alerts", label: "Login Alerts", description: "Alert on new device login", type: "toggle", value: true },
          { key: "sec_session_timeout_min", label: "Session Timeout (min)", description: "Auto logout inactivity", type: "number", value: "30" },
          { key: "sec_max_failed_logins", label: "Max Failed Logins", description: "Lock after attempts", type: "number", value: "5" },
        ],
      },
      {
        title: "Safety Tools", icon: AlertTriangle,
        fields: [
          { key: "safety_sos", label: "SOS Emergency", description: "Emergency SOS feature", type: "toggle", value: true },
          { key: "safety_ride_monitoring", label: "Ride Monitoring", description: "Monitor rides for safety", type: "toggle", value: true },
          { key: "safety_audio_recording", label: "Audio Recording", description: "Record audio during trip", type: "toggle", value: false },
          { key: "safety_trusted_contacts", label: "Trusted Contacts", description: "Add trusted contacts", type: "toggle", value: true },
        ],
      },
      {
        title: "Fraud Prevention", icon: Eye,
        fields: [
          { key: "fraud_fake_ride", label: "Fake Ride Detection", description: "Detect fraudulent rides", type: "toggle", value: true },
          { key: "fraud_fake_gps", label: "Fake GPS Detection", description: "Detect GPS spoofing", type: "toggle", value: true },
          { key: "fraud_multiple_accounts", label: "Multiple Account Detection", description: "Detect duplicate accounts", type: "toggle", value: true },
          { key: "fraud_suspicious_activity", label: "Suspicious Activity Alerts", description: "Alert on suspicious behavior", type: "toggle", value: true },
        ],
      },
    ],
  },
  {
    id: "vehicle", title: "Vehicle", icon: Car,
    groups: [
      {
        title: "Vehicle Types", icon: Car,
        fields: [
          { key: "veh_type_sedan", label: "Sedan (Economy)", description: "Standard economy cars", type: "toggle", value: true },
          { key: "veh_type_suv", label: "SUV (Comfort)", description: "Comfort/XL SUVs", type: "toggle", value: true },
          { key: "veh_type_motorbike", label: "Motorbike (Boda)", description: "Motorbike rides", type: "toggle", value: false },
          { key: "veh_type_van", label: "Van/Minibus", description: "Large group vehicles", type: "toggle", value: false },
          { key: "veh_type_luxury", label: "Luxury/Premium", description: "Premium vehicles", type: "toggle", value: false },
        ],
      },
      {
        title: "Vehicle Requirements", icon: FileText,
        fields: [
          { key: "veh_max_age_years", label: "Max Vehicle Age (years)", description: "Oldest allowed vehicle", type: "number", value: "15" },
          { key: "veh_insurance_required", label: "Insurance Required", description: "Mandatory insurance", type: "toggle", value: true },
          { key: "veh_inspection_required", label: "Inspection Required", description: "Mandatory inspection", type: "toggle", value: true },
          { key: "veh_inspection_interval_months", label: "Inspection Interval (months)", description: "How often to inspect", type: "number", value: "12" },
          { key: "veh_insurance_expiry_alert_days", label: "Insurance Expiry Alert (days)", description: "Days before expiry alert", type: "number", value: "30" },
        ],
      },
    ],
  },
  {
    id: "admin_roles", title: "Admin Roles", icon: Shield,
    groups: [
      {
        title: "Role Management", icon: Users,
        fields: [
          { key: "admin_super_admin", label: "Super Admin", description: "Full system access", type: "toggle", value: true },
          { key: "admin_operations", label: "Operations Admin", description: "Manage rides, drivers, vehicles", type: "toggle", value: true },
          { key: "admin_finance", label: "Finance Admin", description: "Manage payments, wallets, payouts", type: "toggle", value: true },
          { key: "admin_support", label: "Support Admin", description: "Manage tickets, complaints", type: "toggle", value: true },
          { key: "admin_dispatcher", label: "Dispatch Admin", description: "Manage ride dispatch", type: "toggle", value: true },
          { key: "admin_marketing", label: "Marketing Admin", description: "Manage promos, campaigns", type: "toggle", value: true },
          { key: "admin_readonly", label: "Read-Only Admin", description: "View only, no edits", type: "toggle", value: true },
        ],
      },
      {
        title: "Permissions", icon: Lock,
        fields: [
          { key: "perm_view_only", label: "View Only", description: "Read-only dashboard access", type: "toggle", value: true },
          { key: "perm_edit_settings", label: "Edit Settings", description: "Edit app settings", type: "toggle", value: true },
          { key: "perm_manage_users", label: "Manage Users", description: "User management", type: "toggle", value: true },
          { key: "perm_approve_drivers", label: "Approve Drivers", description: "Driver approval", type: "toggle", value: true },
          { key: "perm_process_payouts", label: "Process Payouts", description: "Payout processing", type: "toggle", value: true },
          { key: "perm_suspend_users", label: "Suspend Users", description: "User suspension", type: "toggle", value: true },
        ],
      },
    ],
  },
];

// PERMISSION MAP: which admin role can edit which section
const roleSectionPermissions: Record<string, string[]> = {
  super_admin: ["general","rider","driver","finance","promo","dispatch","notifications","safety","vehicle","admin_roles"],
  operations_admin: ["general","rider","driver","vehicle","dispatch"],
  finance_admin: ["finance","promo"],
  support_admin: [], // read only
  dispatch_admin: ["dispatch","driver"],
  marketing_admin: ["promo","notifications"],
  read_only_admin: [],
};

function canEditSection(roleName: string | undefined, section: string): boolean {
  if (!roleName) return false;
  const allowed = roleSectionPermissions[roleName];
  return allowed ? allowed.includes(section) : false;
}

function supabaseJsonParse(v: unknown): string | boolean | number {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (typeof parsed === "boolean" || typeof parsed === "number") return parsed;
      return v;
    } catch {
      return v;
    }
  }
  return String(v ?? "");
}

export default function SettingsPage() {
  const { adminProfile } = useAuth();
  const roleName = adminProfile?.role;
  const [activeTab, setActiveTab] = useState("general");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editingValues, setEditingValues] = useState<Record<string, string | boolean | number>>(() => {
    const init: Record<string, string | boolean | number> = {};
    settingsData.forEach(section => {
      section.groups.forEach(group => {
        group.fields.forEach(field => {
          init[field.key] = field.value;
        });
      });
    });
    return init;
  });
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [dbLoading, setDbLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load settings from Supabase on mount
  const loadFromSupabase = useCallback(async () => {
    setDbLoading(true);
    try {
      const { data, error } = await supabase.from("app_settings").select("setting_key, setting_value");
      if (error) throw error;
      if (data && data.length > 0) {
        setEditingValues(prev => {
          const next = { ...prev };
          data.forEach((row: { setting_key: string; setting_value: unknown }) => {
            next[row.setting_key] = supabaseJsonParse(row.setting_value);
          });
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to load settings from Supabase:", err);
      // Keep defaults on error — page still works
    } finally {
      setDbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromSupabase();
  }, [loadFromSupabase]);

  const toggleGroup = (groupTitle: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupTitle]: !prev[groupTitle] }));
  };

  const handleSave = async (key: string) => {
    if (!canEditSection(roleName, activeTab)) {
      setSaveError(`Your role (${roleName || "unknown"}) cannot edit ${activeTab} settings.`);
      setTimeout(() => setSaveError(null), 4000);
      return;
    }
    setSaveError(null);
    const rawValue = editingValues[key];
    let jsonValue: unknown = rawValue;
    if (typeof rawValue === "string" && (rawValue.startsWith("http") || rawValue.startsWith('"'))) {
      jsonValue = rawValue;
    }

    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          {
            setting_key: key,
            setting_value: typeof rawValue === "boolean" ? rawValue : typeof rawValue === "string" && !isNaN(Number(rawValue)) ? Number(rawValue) : rawValue,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "setting_key" }
        );
      if (error) throw error;
      setSavedKeys(prev => new Set(prev).add(key));
      setTimeout(() => setSavedKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }), 2000);
    } catch (err) {
      console.error("Save error:", err);
      setSaveError("Failed to save. Check console for details.");
      setTimeout(() => setSaveError(null), 4000);
    }
  };

  const handleToggle = async (key: string) => {
    if (!canEditSection(roleName, activeTab)) {
      setSaveError(`Your role (${roleName || "unknown"}) cannot edit ${activeTab} settings.`);
      setTimeout(() => setSaveError(null), 4000);
      return;
    }
    setSaveError(null);
    const newValue = !editingValues[key];
    setEditingValues(prev => ({ ...prev, [key]: newValue }));

    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { setting_key: key, setting_value: newValue, updated_at: new Date().toISOString() },
          { onConflict: "setting_key" }
        );
      if (error) throw error;
      setSavedKeys(prev => new Set(prev).add(key));
      setTimeout(() => setSavedKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }), 2000);
    } catch (err) {
      console.error("Toggle save error:", err);
      setEditingValues(prev => ({ ...prev, [key]: !newValue })); // revert
      setSaveError("Failed to save toggle. Reverted.");
      setTimeout(() => setSaveError(null), 4000);
    }
  };

  const activeSection = settingsData.find(s => s.id === activeTab);
  const userCanEdit = canEditSection(roleName, activeTab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">
          Control center — manage all aspects of the WeAfrica Ride platform
        </p>
      </div>

      {/* Permission & Error Banner */}
      {roleName && !userCanEdit && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Read-only access</p>
            <p className="text-xs text-amber-600">
              Your role ({roleName}) can view {activeTab} settings but cannot edit them.
            </p>
          </div>
        </div>
      )}
      {roleName && userCanEdit && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <p className="text-xs text-green-700">
            Editing as <span className="font-medium">{roleName.replace(/_/g, " ")}</span> — changes save to Supabase
          </p>
        </div>
      )}
      {saveError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <ShieldAlert className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{saveError}</p>
        </div>
      )}
      {dbLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 text-green-600 animate-spin" />
          <span className="ml-2 text-sm text-gray-500">Loading settings from database...</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {settingsData.map(section => {
          const Icon = section.icon;
          const isActive = activeTab === section.id;
          return (
            <button
              key={section.id}
              onClick={() => setActiveTab(section.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? "border-green-600 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <Icon className="h-4 w-4" />
              {section.title}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeSection && (
        <div className="space-y-4">
          {activeSection.groups.map((group, gIdx) => {
            const isExpanded = expandedGroups[group.title] !== false;
            const GroupIcon = group.icon;
            return (
              <div
                key={gIdx}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                <button
                  onClick={() => toggleGroup(group.title)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-50 rounded-lg">
                      <GroupIcon className="h-5 w-5 text-green-600" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-base font-semibold text-gray-900">{group.title}</h3>
                      <p className="text-xs text-gray-400">{group.fields.length} setting{group.fields.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
                </button>

                {isExpanded && (
                  <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {group.fields.map(field => {
                      const currentValue = editingValues[field.key];
                      const isSaved = savedKeys.has(field.key);
                      const isDirty = String(currentValue) !== String(field.value);

                      return (
                        <div
                          key={field.key}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50/50"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{field.label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{field.description}</p>
                          </div>

                          <div className="flex items-center gap-3 flex-shrink-0">
                            {field.type === "toggle" ? (
                              <button
                                onClick={() => handleToggle(field.key)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                  currentValue ? "bg-green-600" : "bg-gray-300"
                                }`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  currentValue ? "translate-x-6" : "translate-x-1"
                                }`} />
                              </button>
                            ) : field.type === "select" ? (
                              <select
                                value={String(currentValue)}
                                onChange={(e) => setEditingValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                                className="w-48 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                              >
                                {field.options?.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
                                value={String(currentValue)}
                                onChange={(e) => setEditingValues(prev => ({ ...prev, [field.key]: field.type === "number" ? e.target.value : e.target.value }))}
                                className={`px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
                                  field.type === "number" ? "w-28" : field.type === "url" || field.type === "email" ? "w-64" : "w-48"
                                }`}
                                step={field.type === "number" ? "any" : undefined}
                              />
                            )}

                            {field.type !== "toggle" && (
                              <button
                                onClick={() => handleSave(field.key)}
                                disabled={!isDirty && !isSaved}
                                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                                  isSaved
                                    ? "bg-green-100 text-green-700"
                                    : isDirty
                                    ? "bg-green-600 text-white hover:bg-green-700"
                                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                }`}
                              >
                                <Save className="h-3.5 w-3.5" />
                                {isSaved ? "Saved!" : "Save"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-6 h-6 bg-blue-100 rounded-full flex-shrink-0 mt-0.5">
            <span className="text-blue-600 text-xs font-bold">i</span>
          </div>
          <div>
            <p className="text-sm font-medium text-blue-900">Enterprise Settings System</p>
            <p className="text-xs text-blue-600 mt-1">
              {settingsData.length} sections • All changes auto-save to Supabase • Every setting change creates an audit log • Toggle changes save instantly
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}