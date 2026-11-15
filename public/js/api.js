const TOKEN_KEY = 'saathi.token';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const session = {
  get() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      return;
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      return;
    }
  },
};

let onUnauthorized = () => {};

export function handleUnauthorized(callback) {
  onUnauthorized = callback;
}

export async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  const token = session.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'You seem to be offline. Please check your connection and try again.');
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token) {
      session.clear();
      onUnauthorized();
    }
    throw new ApiError(response.status, data?.error ?? 'Something went wrong. Please try again.', data?.details);
  }
  return data;
}

export const api = {
  createCircle: (payload) => request('POST', '/api/circles', payload),
  signIn: (circleCode, passcode) => request('POST', '/api/sessions', { circleCode, passcode }),
  circle: () => request('GET', '/api/circle'),
  updateProfile: (patch) => request('PATCH', '/api/circle/profile', patch),
  updateSettings: (patch) => request('PATCH', '/api/circle/settings', patch),
  addMember: (member) => request('POST', '/api/circle/members', member),
  removeMember: (id) => request('DELETE', `/api/circle/members/${encodeURIComponent(id)}`),
  updateMe: (patch) => request('PATCH', '/api/circle/members/me', patch),
  addMedication: (med) => request('POST', '/api/circle/medications', med),
  updateMedication: (id, patch) => request('PATCH', `/api/circle/medications/${encodeURIComponent(id)}`, patch),
  removeMedication: (id) => request('DELETE', `/api/circle/medications/${encodeURIComponent(id)}`),
  decide: (id, approve) => request('POST', `/api/circle/medications/${encodeURIComponent(id)}/decision`, { approve }),
  logDose: (key, status) => request('POST', '/api/circle/doses', { key, status }),
  addAppointment: (appointment) => request('POST', '/api/circle/appointments', appointment),
  updateAppointment: (id, patch) => request('PATCH', `/api/circle/appointments/${encodeURIComponent(id)}`, patch),
  removeAppointment: (id) => request('DELETE', `/api/circle/appointments/${encodeURIComponent(id)}`),
  testEmail: () => request('POST', '/api/circle/test-email', {}),
  aiMedication: (text) => request('POST', '/api/ai/medication', { text }),
  aiScan: (image, mimeType) => request('POST', '/api/ai/scan', { image, mimeType }),
  aiBrief: (language) => request('POST', '/api/ai/brief', { language }),
};
