const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8082/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('sim_token') || null;
    this.username = localStorage.getItem('sim_username') || null;
  }

  setAuth(token, username) {
    this.token = token;
    this.username = username;
    if (token) {
      localStorage.setItem('sim_token', token);
      localStorage.setItem('sim_username', username);
    } else {
      localStorage.removeItem('sim_token');
      localStorage.removeItem('sim_username');
    }
  }

  isAuthenticated() {
    return !!this.token;
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const headers = this.getHeaders();
    const config = {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      // If unauthorized, clear local auth
      if (response.status === 401) {
        this.setAuth(null, null);
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Something went wrong');
      }
      return data;
    } catch (error) {
      console.error(`API Error on ${endpoint}:`, error);
      throw error;
    }
  }

  async signup(username, email, password) {
    return this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  async login(usernameOrEmail, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usernameOrEmail, password }),
    });
    if (data.token) {
      this.setAuth(data.token, data.username);
    }
    return data;
  }

  logout() {
    // Send background logout request (ignore errors)
    if (this.token) {
      fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: this.getHeaders(),
      }).catch(e => console.error('Logout request failed', e));
    }
    this.setAuth(null, null);
  }

  async getMe() {
    return this.request('/auth/me');
  }

  async saveSimulation(name, description, config, results) {
    return this.request('/simulations/save', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description,
        configJson: JSON.stringify(config),
        resultsJson: JSON.stringify(results),
      }),
    });
  }

  async getSimulations() {
    return this.request('/simulations/list');
  }

  async deleteSimulation(id) {
    return this.request(`/simulations/${id}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiClient();
