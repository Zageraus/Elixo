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

export interface DoctorOption {
  id: string;
  full_name: string;
}

export const api = {
  register: (body: {
    email: string;
    password: string;
    full_name: string;
    role: "patient" | "doctor";
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
  getDoctors: () => request<DoctorOption[]>("/api/appointments/doctors"),
  getAppointments: () => request<any[]>("/api/appointments"),
  createAppointment: (body: { doctor_id: string; scheduled_at: string; reason?: string }) =>
    request("/api/appointments", { method: "POST", body: JSON.stringify(body) }),
  updateAppointmentStatus: (id: string, status: "confirmed" | "completed" | "cancelled" | "no_show") =>
    request(`/api/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  getReports: () => request<any[]>("/api/reports"),
  uploadReport: (form: FormData) => request("/api/reports", { method: "POST", body: form }),
  getPrescriptions: () => request<any[]>("/api/prescriptions"),
  createPrescription: (body: CreatePrescriptionInput) =>
    request<any>("/api/prescriptions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getAnalytics: () => request<any>("/api/admin/analytics"),
  getDoctorLoad: () => request<any[]>("/api/admin/doctor-load"),
  demoLogin: (role: "patient" | "doctor" | "admin") =>
    request<{ token: string; user: any }>("/api/auth/demo", {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
};
