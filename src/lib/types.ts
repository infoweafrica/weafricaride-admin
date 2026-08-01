// =====================================================
// WeAfrica Ride Admin Dashboard — Complete Type System
// 16 roles, 28 permissions, department-grouped navigation
// =====================================================

// ─── ROLES (16 production roles) ──────────────────────

export type AdminRoleName =
  | 'superadmin'
  | 'operations_manager'
  | 'dispatch_operator'
  | 'city_manager'
  | 'driver_onboarding'
  | 'vehicle_inspector'
  | 'safety_officer'
  | 'incident_reviewer'
  | 'finance_manager'
  | 'accounts_officer'
  | 'support_agent'
  | 'customer_success'
  | 'marketing_manager'
  | 'moderator'
  | 'investor'
  | 'analyst'
  | 'system_admin';

// Legacy alias — keep for backward compat during migration
export type Role = 'admin' | 'operator' | 'analyst';

export type AdminStatus = 'active' | 'suspended';

// ─── PERMISSIONS (28 fine-grained keys) ───────────────

export type Permission =
  // Super
  | 'all_access'
  // Staff
  | 'manage_staff'
  | 'manage_roles'
  // Users & Drivers
  | 'manage_users'
  | 'manage_drivers'
  | 'approve_drivers'
  | 'approve_vehicles'
  // Operations
  | 'manage_rides'
  | 'dispatch_rides'
  | 'view_live_map'
  // Safety
  | 'manage_incidents'
  | 'manage_emergencies'
  | 'view_trip_playback'
  // Finance
  | 'manage_finance'
  | 'manage_pricing'
  | 'approve_payouts'
  | 'process_refunds'
  // Support
  | 'manage_support'
  | 'manage_disputes'
  // Marketing
  | 'manage_promotions'
  | 'manage_notifications'
  | 'moderate_content'
  // Analytics
  | 'view_analytics'
  | 'export_data'
  // Technical
  | 'system_settings'
  | 'manage_integrations'
  | 'view_logs'
  | 'maintenance_mode';

// ─── DEPARTMENTS (for grouping nav + pages) ───────────

export type Department =
  | 'superadmin'
  | 'operations'
  | 'drivers'
  | 'safety'
  | 'finance'
  | 'support'
  | 'marketing'
  | 'analytics'
  | 'technical';

export interface DepartmentGroup {
  department: Department;
  label: string;
  icon: string;
  roles: AdminRoleName[];
}

export const DEPARTMENT_GROUPS: DepartmentGroup[] = [
  {
    department: 'operations',
    label: 'Operations',
    icon: '🚗',
    roles: ['superadmin', 'operations_manager', 'dispatch_operator', 'city_manager'],
  },
  {
    department: 'drivers',
    label: 'Drivers & Vehicles',
    icon: '🧑‍✈️',
    roles: ['superadmin', 'operations_manager', 'driver_onboarding', 'vehicle_inspector', 'city_manager'],
  },
  {
    department: 'safety',
    label: 'Safety & Incidents',
    icon: '🛡️',
    roles: ['superadmin', 'operations_manager', 'safety_officer', 'incident_reviewer'],
  },
  {
    department: 'finance',
    label: 'Finance',
    icon: '💰',
    roles: ['superadmin', 'finance_manager', 'accounts_officer'],
  },
  {
    department: 'support',
    label: 'Support',
    icon: '🎫',
    roles: ['superadmin', 'operations_manager', 'support_agent', 'customer_success', 'city_manager'],
  },
  {
    department: 'marketing',
    label: 'Marketing',
    icon: '📢',
    roles: ['superadmin', 'marketing_manager', 'moderator', 'customer_success', 'city_manager'],
  },
  {
    department: 'analytics',
    label: 'Analytics',
    icon: '📊',
    roles: ['superadmin', 'operations_manager', 'finance_manager', 'analyst', 'marketing_manager', 'customer_success', 'investor'],
  },
  {
    department: 'technical',
    label: 'Technical',
    icon: '⚙️',
    roles: ['superadmin', 'system_admin'],
  },
];

// ─── NAVIGATION ITEMS ─────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  department: Department;
  permission?: Permission;
  roles?: AdminRoleName[];
}

export const SUPADMIN_ONLY_NAV: NavItem[] = [
  { label: 'Staff Management', href: '/admin/staff', icon: '👩‍💼', department: 'superadmin', permission: 'manage_staff' },
  { label: 'Audit Log', href: '/admin/audit-logs', icon: '📋', department: 'superadmin', permission: 'all_access' },
  { label: 'Settings', href: '/admin/settings', icon: '⚙️', department: 'technical', permission: 'system_settings' },
];

export const DEPARTMENT_NAV: NavItem[] = [
  // Operations
  { label: 'Dashboard', href: '/admin/dashboard', icon: '📊', department: 'operations', permission: 'view_analytics' },
  { label: 'Live Map', href: '/admin/operations/live-map', icon: '🗺️', department: 'operations', permission: 'view_live_map' },
  { label: 'Rides', href: '/admin/rides', icon: '🚗', department: 'operations', permission: 'manage_rides' },
  { label: 'Dispatch Queue', href: '/admin/operations/dispatch', icon: '📡', department: 'operations', permission: 'dispatch_rides' },
  { label: 'Operator Booking', href: '/admin/operations/operator-booking', icon: '☎️', department: 'operations', permission: 'dispatch_rides' },
  { label: 'Fleet Monitoring', href: '/admin/operations/fleet-monitoring', icon: '📋', department: 'operations', permission: 'view_live_map' },
  { label: 'Service Zones', href: '/admin/operations/service-zones', icon: '📍', department: 'operations', permission: 'manage_rides' },

  // Drivers & Vehicles
  { label: 'Drivers', href: '/admin/drivers', icon: '🧑‍✈️', department: 'drivers', permission: 'manage_drivers' },
  { label: 'Onboarding', href: '/admin/drivers/onboarding', icon: '📝', department: 'drivers', permission: 'approve_drivers' },
  { label: 'Vehicles', href: '/admin/vehicles', icon: '🚙', department: 'drivers', permission: 'approve_vehicles' },
  { label: 'Vehicle Classes', href: '/admin/vehicles/classes', icon: '🚘', department: 'drivers', permission: 'approve_vehicles' },
  { label: 'Riders', href: '/admin/users', icon: '🧑‍🤝‍🧑', department: 'drivers', permission: 'manage_users' },
  { label: 'Driver Wallets', href: '/admin/drivers/wallets', icon: '👛', department: 'drivers', permission: 'manage_finance' },
  { label: 'Driver Performance', href: '/admin/drivers/performance', icon: '📊', department: 'drivers', permission: 'view_analytics' },

  // Safety
  { label: 'Safety Center', href: '/admin/safety/center', icon: '🛡️', department: 'safety', permission: 'manage_incidents' },
  { label: 'Verification', href: '/admin/safety/verification', icon: '✅', department: 'safety', permission: 'approve_drivers' },
  { label: 'Incidents', href: '/admin/safety/incidents', icon: '🚨', department: 'safety', permission: 'manage_incidents' },
  { label: 'Emergencies', href: '/admin/safety/emergencies', icon: '🆘', department: 'safety', permission: 'manage_emergencies' },
  { label: 'Trip Playback', href: '/admin/safety/playback', icon: '▶️', department: 'safety', permission: 'view_trip_playback' },

  // Finance
  { label: 'Transactions', href: '/admin/finance/transactions', icon: '💳', department: 'finance', permission: 'manage_finance' },
  { label: 'Driver Earnings', href: '/admin/finance/earnings', icon: '💰', department: 'finance', permission: 'manage_finance' },
  { label: 'Commissions', href: '/admin/finance/commissions', icon: '📈', department: 'finance', permission: 'manage_pricing' },
  { label: 'Payouts', href: '/admin/finance/payouts', icon: '💸', department: 'finance', permission: 'approve_payouts' },
  { label: 'Refunds', href: '/admin/finance/refunds', icon: '↩️', department: 'finance', permission: 'process_refunds' },
  { label: 'Wallets', href: '/admin/finance/wallets', icon: '🏦', department: 'finance', permission: 'manage_finance' },
  { label: 'Reconciliation', href: '/admin/finance/reconciliation', icon: '🔄', department: 'finance', permission: 'manage_finance' },
  { label: 'Pricing', href: '/admin/finance/pricing', icon: '🏷️', department: 'finance', permission: 'manage_pricing' },

  // Support
  { label: 'Tickets', href: '/admin/support/tickets', icon: '🎫', department: 'support', permission: 'manage_support' },
  { label: 'Disputes', href: '/admin/support/disputes', icon: '⚖️', department: 'support', permission: 'manage_disputes' },
  { label: 'Call Center', href: '/admin/support/call-center', icon: '📞', department: 'support', permission: 'manage_support' },
  { label: 'Complaints', href: '/admin/support/complaints', icon: '⚠️', department: 'support', permission: 'manage_support' },

  // Marketing
  { label: 'Marketing Dashboard', href: '/admin/marketing/dashboard', icon: '📢', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Promo Codes', href: '/admin/marketing/promos', icon: '🏷️', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Campaigns', href: '/admin/marketing/campaigns', icon: '🎯', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Push Notifications', href: '/admin/marketing/notifications', icon: '🔔', department: 'marketing', permission: 'manage_notifications' },
  { label: 'Banners', href: '/admin/marketing/banners', icon: '🖼️', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Rewards', href: '/admin/marketing/rewards', icon: '💳', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Loyalty Program', href: '/admin/marketing/loyalty', icon: '🏆', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Customer Segments', href: '/admin/marketing/segments', icon: '🧩', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Marketing Analytics', href: '/admin/marketing/analytics', icon: '📊', department: 'marketing', permission: 'view_analytics' },
  { label: 'Driver Missions', href: '/admin/marketing/driver-missions', icon: '🎖️', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Demand Events', href: '/admin/marketing/events', icon: '📈', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Referrals', href: '/admin/marketing/referrals', icon: '🎁', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Corporate Accounts', href: '/admin/marketing/corporate-accounts', icon: '🏢', department: 'marketing', permission: 'manage_promotions' },
  { label: 'Content Moderation', href: '/admin/marketing/moderation', icon: '🖼️', department: 'marketing', permission: 'moderate_content' },

  // Analytics
  { label: 'Reports', href: '/admin/analytics/reports', icon: '📈', department: 'analytics', permission: 'view_analytics' },
  { label: 'Revenue Analytics', href: '/admin/analytics/revenue', icon: '📊', department: 'analytics', permission: 'view_analytics' },
  { label: 'Driver Analytics', href: '/admin/analytics/drivers', icon: '🧑‍✈️', department: 'analytics', permission: 'view_analytics' },
  { label: 'Rider Analytics', href: '/admin/analytics/riders', icon: '🧑‍🤝‍🧑', department: 'analytics', permission: 'view_analytics' },

  // Technical
  { label: 'Feature Flags', href: '/admin/technical/flags', icon: '🚩', department: 'technical', permission: 'system_settings' },
  { label: 'API Logs', href: '/admin/technical/logs', icon: '📜', department: 'technical', permission: 'view_logs' },
  { label: 'Integrations', href: '/admin/technical/integrations', icon: '🔌', department: 'technical', permission: 'manage_integrations' },
  { label: 'Realtime Monitoring', href: '/admin/technical/realtime', icon: '📡', department: 'technical', permission: 'view_logs' },
  { label: 'Notification Logs', href: '/admin/technical/notifications', icon: '🔔', department: 'technical', permission: 'view_logs' },
];

// ─── GEOGRAPHY ────────────────────────────────────────

export type City =
  | 'blantyre'
  | 'lilongwe'
  | 'mzuzu'
  | 'zomba'
  | 'capetown'
  | 'johannesburg'
  | 'lusaka'
  | 'harare'
  | 'nairobi'
  | 'dar_es_salaam';

export type Country = 'mw' | 'za' | 'zm' | 'zw' | 'ke' | 'tz';

export type Currency = 'MWK' | 'ZAR' | 'ZMW' | 'USD' | 'KES' | 'TZS';

// ─── DRIVER TYPES ─────────────────────────────────────

export type DriverStatus =
  | 'available'
  | 'on_trip'
  | 'offline'
  | 'suspended'
  | 'pending_review';

export type DriverOnboardingStatus =
  | 'applied'
  | 'documents_submitted'
  | 'under_review'
  | 'interview'
  | 'vehicle_inspection'
  | 'approved'
  | 'rejected';

export type VehicleInspectionStatus =
  | 'pending_inspection'
  | 'approved'
  | 'rejected'
  | 'suspended'
  | 'expired_documents'
  | 'unsafe'
  | 'passed'
  | 'pending'
  | 'expired';

// ─── RIDE TYPES ───────────────────────────────────────

export type RideStatus =
  | 'requested'
  | 'searching'
  | 'accepted'
  | 'driver_arriving'
  | 'driver_arrived'
  | 'arrived'
  | 'started'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'rider_cancelled'
  | 'driver_cancelled'
  | 'admin_cancelled'
  | 'no_driver_found'
  | 'no_drivers'
  | 'scheduled';

export type PaymentMethod = 'cash' | 'mobile_money' | 'airtel_money' | 'tnm_mpamba' | 'card' | 'wallet';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'paid';

export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type RefundStatus = 'pending' | 'approved' | 'rejected' | 'completed';

// ─── SAFETY TYPES ─────────────────────────────────────

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentType =
  | 'accident'
  | 'harassment'
  | 'safety_concern'
  | 'dispute'
  | 'fraud'
  | 'other';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'escalated';

export type EmergencyType = 'sos' | 'accident' | 'medical' | 'security' | 'fire' | 'other';
export type EmergencyStatus = 'active' | 'responding' | 'resolved' | 'false_alarm';

// ─── SUPPORT TYPES ────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory =
  | 'ride_issue'
  | 'payment_issue'
  | 'account_issue'
  | 'driver_complaint'
  | 'rider_complaint'
  | 'technical'
  | 'other';

// ─── MARKETING TYPES ──────────────────────────────────

export type PromoType = 'percentage' | 'fixed' | 'free_ride';
export type PromoStatus = 'active' | 'scheduled' | 'expired' | 'disabled';
export type PromoRecipient = 'all' | 'new_users' | 'specific_users' | 'drivers' | 'city';

// ─── AUDIT TYPES ──────────────────────────────────────

export type AuditAction =
  | 'login'
  | 'logout'
  | 'create_user'
  | 'update_user'
  | 'delete_user'
  | 'suspend_user'
  | 'ban_user'
  | 'update_settings'
  | 'create_promo'
  | 'update_promo'
  | 'process_refund'
  | 'approve_payout'
  | 'modify_ride'
  | 'update_pricing'
  | 'assign_role'
  | 'remove_role'
  | 'dispatch_ride'
  | 'resolve_incident'
  | 'toggle_maintenance'
  | 'update_feature_flag';

// ─── INTERFACES ───────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  display_name?: string;
  name?: string;
  role_id: string;
  role_name: AdminRoleName;
  role?: string;
  status: AdminStatus;
  city?: City | null;
  country_code?: Country | null;
  phone?: string | null;
  phone_number?: string;
  is_active?: boolean;
  avatar_url?: string | null;
  last_sign_in?: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface AdminRole {
  id: string;
  name: AdminRoleName;
  description?: string;
  permissions: Permission[];
  created_at: string;
}

export interface AdminPermission {
  id: string;
  name: Permission;
  description?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  admin_id: string;
  admin_email: string;
  action: AuditAction;
  entity_type: string;
  entity_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface Driver {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  phone?: string;
  city: City;
  status: DriverStatus;
  onboarding_status: DriverOnboardingStatus;
  vehicle_info?: VehicleInfo;
  rating?: number;
  total_trips?: number;
  total_earnings?: number;
  created_at: string;
  // Supabase join fields (used by drivers page)
   
  user?: Record<string, any>;
   
  vehicle?: Record<string, any>;
  is_online?: boolean;
  approval_status?: string;
  total_rides?: number;
  driver_license_number?: string;
  driver_license_expiry?: string;
  available_balance?: number;
  pending_balance?: number;
  cash_collected?: number;
  id_number?: string;
  id_type?: string;
  date_of_birth?: string;
  address?: string;
  can_go_online?: boolean;
  avatar_url?: string | null;
  last_seen_at?: string | null;
  // Document URLs (from storage buckets)
  id_document_url?: string | null;
  license_document_url?: string | null;
  vehicle_registration_url?: string | null;
  insurance_document_url?: string | null;
  profile_picture_url?: string | null;
  vehicle_photo_urls?: string[] | null;
  // Vehicle info
  vehicle_plate?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  // Emergency contact
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  // Identity
  national_id?: string | null;
  license_number?: string | null;
  // Payment
  payout_method?: string | null;
  mobile_money_number?: string | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  referral_code?: string | null;
  referred_by?: string | null;
  // Referral stats (populated by API)
  referral_count?: number;
  referral_earnings?: number;
}

// ─── REFERRAL TYPES ───────────────────────────────────

export type ReferralStatus =
  | 'pending'
  | 'signed_up'
  | 'documents_submitted'
  | 'under_review'
  | 'documents_approved'
  | 'first_trip_completed'
  | 'first_ride_completed'
  | 'bonus_approved'
  | 'credit_approved'
  | 'bonus_paid'
  | 'credit_issued'
  | 'fraud_review'
  | 'rejected'
  | 'suspended';

export type FraudVerdict = 'safe' | 'review' | 'blocked';

export interface DriverReferral {
  id: string;
  referrer_id: string;
  referred_driver_id: string | null;
  referral_code: string;
  campaign_id: string | null;
  status: ReferralStatus;
  bonus_amount: number;
  bonus_currency: string;
  bonus_paid_at: string | null;
  fraud_verdict: FraudVerdict | null;
  fraud_checked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Join fields
  referrer?: Record<string, any>;
  referred_driver?: Record<string, any>;
  campaign?: Record<string, any>;
}

export interface RiderReferral {
  id: string;
  referrer_id: string;
  referred_rider_id: string | null;
  referral_code: string;
  campaign_id: string | null;
  status: ReferralStatus;
  credit_amount: number;
  credit_currency: string;
  credit_issued_at: string | null;
  first_ride_completed_at: string | null;
  fraud_verdict: FraudVerdict | null;
  fraud_checked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Join fields
  referrer?: Record<string, any>;
  referred_rider?: Record<string, any>;
}

export interface ReferralCampaign {
  id: string;
  name: string;
  description: string | null;
  campaign_type: 'driver' | 'rider' | 'both';
  starts_at: string;
  ends_at: string;
  driver_bonus_amount: number;
  driver_bonus_currency: string;
  rider_credit_amount: number;
  rider_credit_currency: string;
  conditions: Record<string, unknown>;
  target_city: string | null;
  target_vehicle_type: string | null;
  is_active: boolean;
  max_referrals_per_user: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralReward {
  id: string;
  referral_id: string;
  referral_type: 'driver' | 'rider';
  recipient_id: string;
  recipient_type: 'driver' | 'rider';
  amount: number;
  currency: string;
  reward_type: 'bonus' | 'credit' | 'payout';
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  transaction_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralFraudCheck {
  id: string;
  referral_id: string;
  referral_type: 'driver' | 'rider';
  check_type: string;
  result: 'pass' | 'fail' | 'suspicious';
  details: Record<string, unknown>;
  checked_at: string;
}

export interface ReferralEvent {
  id: string;
  referral_id: string | null;
  referral_type: string | null;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  actor_id: string | null;
  actor_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ReferralSettings {
  defaults: { driver_bonus: number; rider_credit: number; currency: string };
  rules: { min_trips_for_bonus: number; require_verified_docs: boolean; max_referrals_per_user: number | null; expiry_days: number | null };
  fraud: { same_phone_block: boolean; max_daily_referrals: number; self_referral_block: boolean };
}

export interface ReferralAnalytics {
  day: string;
  driver_referrals: number;
  rider_referrals: number;
  driver_bonuses_approved: number;
  rider_credits_approved: number;
  total_bonus_amount: number;
}

export interface TopReferrer {
  referrer_id: string;
  referrer_name: string;
  total_referrals: number;
  successful_referrals: number;
  total_bonus: number;
  conversion_rate: number;
}

export interface VehicleInfo {
  make: string;
  model: string;
  year: number;
  color: string;
  plate_number: string;
  inspection_status: VehicleInspectionStatus;
  inspection_photos?: string[];
  registration_expiry?: string;
  insurance_expiry?: string;
  inspection_notes?: string;
}

export interface Ride {
  id: string;
  rider_id: string;
  rider_name: string;
  driver_id?: string;
  driver_name?: string;
  status: RideStatus;
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  currency: Currency;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  distance_km?: number;
  duration_min?: number;
  city: City;
  requested_at: string;
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  // Supabase join fields (used by dashboard/rides pages)
   
  rider?: Record<string, any>;
   
  driver?: Record<string, any>;
   
  vehicle?: Record<string, any>;
   
  category?: Record<string, any>;
  actual_fare?: number;
  estimated_fare?: number;
  driver_earnings?: number;
  company_commission?: number;
  commission_amount?: number;
  commission_rate?: number;
  created_at: string;
  base_fare?: number;
  actual_distance_km?: number;
  estimated_distance_km?: number;
  distance_fare?: number;
  actual_duration_minutes?: number;
  estimated_duration_minutes?: number;
  time_fare?: number;
  waiting_fee?: number;
  cancellation_fee?: number;
  promo_discount?: number;
  accepted_at?: string;
  arrived_at?: string;
}

export interface Incident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reported_by?: string;
  ride_id?: string;
  driver_id?: string;
  rider_id?: string;
  description: string;
  resolution?: string;
  city: City;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
}

export interface EmergencyAlert {
  id: string;
  type: EmergencyType;
  status: EmergencyStatus;
  ride_id?: string;
  driver_id?: string;
  rider_id?: string;
  latitude: number;
  longitude: number;
  description?: string;
  responded_by?: string;
  city: City;
  created_at: string;
  resolved_at?: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  user_name: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  description: string;
  assigned_to?: string;
  city: City;
  created_at: string;
  updated_at: string;
}

export interface PromoCode {
  id: string;
  code: string;
  type: PromoType;
  value: number;
  min_order?: number;
  max_discount?: number;
  max_uses?: number;
  current_uses: number;
  recipient_type: PromoRecipient;
  recipient_ids?: string[];
  city?: City;
  applicable_cities?: string[] | null;
  applicable_vehicle_types?: string[] | null;
  first_ride_only?: boolean;
  visible?: boolean;
  status: PromoStatus;
  starts_at?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  ride_id?: string;
  user_id: string;
  user_type: 'rider' | 'driver';
  type: 'payment' | 'payout' | 'refund' | 'commission' | 'topup';
  amount: number;
  currency: Currency;
  status: PaymentStatus | PayoutStatus | RefundStatus;
  payment_method?: PaymentMethod;
  reference?: string;
  city: City;
  created_at: string;
}

export interface Payout {
  id: string;
  driver_id: string;
  driver_name: string;
  amount: number;
  currency: Currency;
  status: PayoutStatus;
  period_start: string;
  period_end: string;
  payout_method?: PaymentMethod | string;
  payout_status?: PayoutStatus | string;
  transaction_count: number;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
}

export interface DashboardStats {
  total_rides: number;
  active_drivers: number;
  total_users: number;
  revenue: number;
  currency: Currency;
  status_distribution?: Record<RideStatus, number>;
  city_distribution?: Record<string, number>;
}

export interface PricingConfig {
  id: string;
  country_code: string;
  city?: string;
  vehicle_type: string;
  base_fare: number;
  minimum_fare: number;
  per_km: number;
  per_min: number;
  booking_fee: number;
  waiting_fee: number;
  cancellation_fee: number;
  surge_multiplier: number;
  commission_percent: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CountryConfig {
  code: Country;
  name: string;
  currency: Currency;
  cities: City[];
  default_language: string;
  is_active: boolean;
  timezone: string;
}

export interface AppSettings {
  app_name: string;
  support_email: string;
  support_phone: string;
  default_commission_rate: number;
  sos_phone: string;
  max_cancellations_per_hour: number;
  auto_suspend_after_cancellations: boolean;
  default_latitude: number;
  default_longitude: number;
  default_zoom: number;
  enable_scheduled_rides: boolean;
  enable_mobile_money: boolean;
  enable_cash_payments: boolean;
  enable_card_payments: boolean;
  driver_min_rating: number;
  driver_max_trip_distance_km: number;
  driver_idle_timeout_minutes: number;
  auto_accept_timeout_seconds: number;
  maintenance_mode: boolean;
  maintenance_message: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  rollout_percentage: number;
  country_codes?: Country[];
  city_codes?: City[];
  updated_by?: string;
  updated_at: string;
}

// ─── PAGINATION & FILTERS ─────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface FilterParams {
  page?: number;
  page_size?: number;
  search?: string;
  city?: City;
  status?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

// ─── LEGACY COMPAT TYPES ──────────────────────────────

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate_number: string;
  inspection_status: VehicleInspectionStatus;
  driver_id?: string;
  driver_name?: string;
  city?: City;
  created_at?: string;
  // Extended fields used by vehicles page
  is_active?: boolean;
  vehicle_type?: string;
  seats?: number;
  insurance_expiry?: string;
  inspection_date?: string;
  vehicle_registration_url?: string;
  vehicle_insurance_url?: string;
  vehicle_photo_urls?: string[] | null;
  updated_at?: string;
  vehicle_class_id?: string | null;
  vehicle_class?: { id: string; name: string; slug: string } | null;

  driver?: Record<string, any>;
}

export interface Wallet {
  id: string;
  user_id: string;
  user_name: string;
  user_type: 'rider' | 'driver';
  balance: number;
  currency: Currency;
  status: 'active' | 'frozen';
  created_at: string;
  updated_at: string;
  // Supabase join fields
   
  user?: Record<string, any>;
  ride_credits?: number;
  promo_balance?: number;
  refund_balance?: number;
  [key: string]: unknown;
}

export interface Payment {
  transaction_reference?: string;
  provider_reference?: string;
  payment_status?: PaymentStatus | string;
  paid_by?: string;
  paid_at?: string;
  refund_amount?: number;
  refund_reason?: string;
  refunded_at?: string;
  refunded_by?: string;
  id: string;
  ride_id?: string;
  user_id: string;
  user_name: string;
  user_type: 'rider' | 'driver';
  amount: number;
  currency: Currency;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  reference?: string;
  created_at: string;
  updated_at?: string;
}

export interface DriverPayout {
  payout_method?: PaymentMethod | string;
  payout_status?: PayoutStatus | string;
  account_details?: Record<string, unknown>;
  transaction_reference?: string;
  processed_by?: string;
  processed_at?: string;
  notes?: string;
  updated_at?: string;
  id: string;
  driver_id: string;
  driver_name: string;
  amount: number;
  currency: Currency;
  status: PayoutStatus;
  period_start: string;
  period_end: string;
  ride_count: number;
  created_at: string;
  // Supabase join field
   
  driver?: Record<string, any>;
}

export interface PricingRule {
  id: string;
  name: string;
  country_code: Country;
  city?: City;
  base_fare: number;
  price_per_km?: number;
  per_km_rate?: number;
  price_per_minute?: number;
  per_min_rate?: number;
  minimum_fare: number;
  cancellation_fee: number;
  waiting_fee_per_minute?: number;
  commission_rate?: number;
  currency?: Currency;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  category_id?: string;
  country_id?: string;
  city_id?: string;
  surge_multiplier?: number;
  category?: RideCategory | null;
}

export interface RideCategory {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  min_seats?: number;
  max_seats?: number;
  base_fare_multiplier: number;
  per_km_multiplier: number;
  per_min_multiplier: number;
  is_active: boolean;
  sort_order?: number;
  created_at: string;
}

export interface Rider {
  id: string;
  user_id: string;
  phone?: string;
  email?: string;
  full_name: string;
  status: 'active' | 'suspended';
  total_rides: number;
  total_spent: number;
  rating: number;
  home_address?: string;
  work_address?: string;
  referral_code?: string;
  is_phone_verified: boolean;
  is_email_verified: boolean;
  is_id_verified: boolean;
  created_at: string;
  updated_at: string;
  // Supabase join fields
  user?: Record<string, unknown>;
  wallet?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  type: 'credit' | 'debit';
  amount: number;
  reference?: string;
  description?: string;
  created_at: string;
}
