import type { PaymentMethod, PaymentSummary } from "./payments";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("healthchain_token");
}

export function setToken(token: string) {
  localStorage.setItem("healthchain_token", token);
}

export function clearToken() {
  localStorage.removeItem("healthchain_token");
}

export function getUser(): any | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("healthchain_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setUser(user: any) {
  if (typeof window !== "undefined") {
    localStorage.setItem("healthchain_user", JSON.stringify(user));
  }
}

export function clearAuth() {
  clearToken();
  if (typeof window !== "undefined") {
    localStorage.removeItem("healthchain_user");
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    // A 401 outside the auth routes means the stored session is expired or
    // no longer valid, so drop it and send the user back to sign in.
    if (res.status === 401 && token && !path.startsWith("/api/auth/")) {
      clearAuth();
      window.location.replace("/");
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? (typeof body.error === "string" ? body.error : JSON.stringify(body.error)) : `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface MedicationItem {
  name: string;
  dosage: string;
  frequency: string;
  duration_days: number;
}

export interface CreatePrescriptionInput {
  patient_id: string;
  appointment_id?: string;
  medications: MedicationItem[];
  notes?: string;
}

/** Envelope returned by list endpoints that take ?page=&page_size=. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const pageQuery = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
};

export interface ManagedUserQuery {
  role: "patient" | "doctor";
  q?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
  page_size?: number;
}

export interface ManagedUserPage extends Paginated<ManagedUser> {
  role_totals: { patient: number; doctor: number };
}

export interface ManagedUser {
  id: string;
  full_name: string;
  email: string | null;
  role: "patient" | "doctor";
  is_active: boolean;
  created_at: string;
  specialization: string | null;
  appointment_count: number;
  prescription_count: number;
  report_count: number;
  payment_count: number;
}

export interface AppNotification {
  id: string;
  type: "appointment" | "report" | "prescription" | "system";
  message: string;
  is_read: boolean;
  created_at: string;
}

export type ChainCheck =
  | { status: "verified" | "mismatch"; anchoredAt: string }
  | { status: "not_anchored" | "disabled" }
  | { status: "unavailable"; error: string };

export interface IntegrityResult {
  recorded_hash: string | null;
  computed_hash: string | null;
  /** Reports only: does the stored file still match the hash recorded at upload? */
  file?: "match" | "changed" | "missing";
  chain: ChainCheck;
}

/** POST /api/reports: each step reports its own outcome. */
export interface ReportUploadResult {
  report: { id: string; title: string };
  blockchain?: { status: "disabled" } | { txHash: string; blockNumber: number; chain: string };
  blockchain_error?: string;
  ai_analysis?: { summary: string };
  ai_error?: string;
}

export type Role = "patient" | "doctor" | "admin";

/** GET /api/auth/me */
export interface AuthedUser {
  id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  wallet_address: string;
  doctor_profile: { specialization: string; license_number: string; consultation_fee: number | null } | null;
}

/** Each role's home page. */
export function dashboardPath(role: Role): string {
  return role === "doctor" ? "/doctor" : role === "admin" ? "/admin" : "/patient";
}

export const BLOOD_GROUPS =["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export interface PatientProfile {
  date_of_birth: string | null;
  blood_group: BloodGroup | null;
  allergies: string | null;
  emergency_contact: string | null;
}

export interface DoctorOption {
  id: string;
  full_name: string;
  specialization: string | null;
}

export const api = {
  register: (body: {
    email: string;
    password: string;
    full_name: string;
    role: "patient" | "doctor";
    specialization?: string;
    license_number?: string;
    consultation_fee?: number;
  }) =>
    request<{ token: string; user: any }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: any }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getNonce: (wallet_address: string) =>
    request<{ message: string; nonce: string }>("/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ wallet_address }),
    }),
  verify: (wallet_address: string, message: string, signature: string, admin_key?: string) =>
    request<{ token: string; user: any }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ wallet_address, message, signature, admin_key }),
    }),
  me: () => request<AuthedUser>("/api/auth/me"),
  getMyProfile: () =>request<PatientProfile>("/api/patients/me/profile"),
  updateMyProfile: (body: PatientProfile) =>
    request<PatientProfile>("/api/patients/me/profile", { method: "PUT", body: JSON.stringify(body) }),
  getDoctors: () => request<DoctorOption[]>("/api/appointments/doctors"),
  getAppointments: () => request<any[]>("/api/appointments"),
  createAppointment: (body: { doctor_id: string; scheduled_at: string; reason?: string }) =>
    request("/api/appointments", { method: "POST", body: JSON.stringify(body) }),
  updateAppointmentStatus: (id: string, status: "confirmed" | "completed" | "cancelled" | "no_show") =>
    request(`/api/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  payForAppointment: (appointment_id: string, method: PaymentMethod) =>
    request<PaymentSummary>("/api/payments", {
      method: "POST",
      body: JSON.stringify({ appointment_id, method }),
    }),
  getReports: (page = 1, page_size = 5) =>
    request<Paginated<any>>(`/api/reports?${pageQuery({ page, page_size })}`),
  uploadReport: (form: FormData) =>
    request<ReportUploadResult>("/api/reports", { method: "POST", body: form }),
  verifyReport: (reportId: string) => request<IntegrityResult>(`/api/reports/${reportId}/verify`),
  verifyPrescription: (prescriptionId: string) =>
    request<IntegrityResult>(`/api/prescriptions/${prescriptionId}/verify`),
  getReportFileUrl: (reportId: string) =>
    request<{ url: string; expires_in: number }>(`/api/reports/${reportId}/file`),
  getPrescriptions: (page = 1, page_size = 5) =>
    request<Paginated<any>>(`/api/prescriptions?${pageQuery({ page, page_size })}`),
  createPrescription: (body: CreatePrescriptionInput) =>
    request<any>("/api/prescriptions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getAnalytics: () => request<any>("/api/admin/analytics"),
  getDoctorLoad: () => request<any[]>("/api/admin/doctor-load"),
  getNotifications: () => request<AppNotification[]>("/api/notifications"),
  markAllNotificationsRead: () =>
    request<{ ok: true }>("/api/notifications/read-all", { method: "PATCH" }),
  getManagedUsers: (query: ManagedUserQuery) =>
    request<ManagedUserPage>(`/api/admin/users?${pageQuery({ ...query })}`),
  setUserActive: (id: string, is_active: boolean) =>
    request<{ id: string; is_active: boolean; cancelled_appointments: number; patients_notified: number }>(
      `/api/admin/users/${id}/active`,
      { method: "PATCH", body: JSON.stringify({ is_active }) }
    ),
  deleteUser: (id: string) =>
    request<{ id: string; deleted: boolean; patients_notified: number }>(`/api/admin/users/${id}`, {
      method: "DELETE",
    }),
  demoLogin: (role: "patient" | "doctor" | "admin") =>
    request<{ token: string; user: any }>("/api/auth/demo", {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
};
