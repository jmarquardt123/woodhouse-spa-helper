const { ENUMS } = require("./constants");

class MeevoClient {
  constructor(target) {
    this.baseUrl = target.baseUrl.replace(/\/$/, "");
    this.tenantId = target.tenantId;
    this.locationId = target.locationId;
    this.session = null;
  }

  async initialize() {
    const url = `${this.baseUrl}/customerportal/api/initialize?tenantId=${this.tenantId}&locationId=${this.locationId}`;
    const body = {
      tenantId: String(this.tenantId),
      application: ENUMS.application.onlineBooking
    };
    this.session = await this.fetchJson(url, {
      method: "POST",
      body
    });
    if (!this.session.bearerToken) {
      throw new Error("Meevo initialize response did not include a bearer token.");
    }
    return this.session;
  }

  async onlineBooking(path, options = {}) {
    if (!this.session) await this.initialize();
    return this.fetchJson(`${this.baseUrl}/onlinebooking/api${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${this.session.bearerToken}`,
        ...(options.headers || {})
      }
    });
  }

  async fetchJson(url, options = {}) {
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      ...(options.headers || {})
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        const suffix = retryAfter ? ` Retry-After: ${retryAfter}` : "";
        throw new Error(`Meevo ${response.status} for ${url}.${suffix} ${text.slice(0, 500)}`);
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timeout);
    }
  }

  get onlineBookingSettings() {
    return this.session?.locationSettings?.onlineBookingSettings || {};
  }

  async serviceCategories() {
    return this.onlineBooking("/ob/servicecategory/list", {
      method: "POST",
      body: {
        pageNumber: 0,
        itemsPerPage: 999,
        sortBy: "",
        sortDirection: 0,
        criteria: {
          objectState: 2026,
          includeActive: true,
          view: 1
        }
      }
    });
  }

  async services(categoryId = null) {
    return this.onlineBooking("/ob/service/list", {
      method: "POST",
      body: {
        pageNumber: 0,
        itemsPerPage: 999,
        sortBy: "",
        sortDirection: 0,
        criteria: {
          objectState: 2026,
          canBookOnline: true,
          isBookable: true,
          ...(categoryId ? { serviceCategoryId: categoryId } : {})
        }
      }
    });
  }

  async scanOpenings(payload) {
    return this.onlineBooking("/ob/scanforopenings", {
      method: "POST",
      body: payload,
      timeoutMs: 90000
    });
  }
}

module.exports = { MeevoClient };

