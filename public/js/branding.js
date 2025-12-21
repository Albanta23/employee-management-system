(function () {
    'use strict';

    const THEME_STORAGE_KEY = 'ems_theme';
    const THEME_DARK = 'dark';
    const THEME_LIGHT = 'light';

    function safeGetLocalStorageItem(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (_) {
            return null;
        }
    }

    function safeSetLocalStorageItem(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (_) {
            // no-op
        }
    }

    function getInitialTheme() {
        const stored = safeGetLocalStorageItem(THEME_STORAGE_KEY);
        if (stored === THEME_DARK || stored === THEME_LIGHT) return stored;

        try {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                return THEME_LIGHT;
            }
        } catch (_) {
            // ignore
        }

        return THEME_DARK;
    }

    function applyTheme(theme, { persist = false } = {}) {
        const root = document.documentElement;
        root.classList.remove('theme-dark', 'theme-light');
        root.classList.add(theme === THEME_LIGHT ? 'theme-light' : 'theme-dark');

        if (persist) safeSetLocalStorageItem(THEME_STORAGE_KEY, theme);

        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) {
            const nextTheme = theme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
            toggleBtn.setAttribute('aria-label', nextTheme === THEME_LIGHT ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
            toggleBtn.setAttribute('title', nextTheme === THEME_LIGHT ? 'Modo claro' : 'Modo oscuro');
            toggleBtn.textContent = nextTheme === THEME_LIGHT ? '☀️' : '🌙';
        }
    }

    function positionThemeToggleButton(btn) {
        if (!btn) return;

        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) {
            btn.style.left = '';
            return;
        }

        const sidebarStyle = window.getComputedStyle(sidebar);
        // Only offset when sidebar is fixed (desktop/tablet). On mobile, sidebar is relative and full-width.
        if (sidebarStyle.position !== 'fixed') {
            btn.style.left = '';
            return;
        }

        const width = Math.max(0, Math.round(sidebar.getBoundingClientRect().width));
        if (!width) {
            btn.style.left = '';
            return;
        }

        // Place the button just outside the sidebar.
        btn.style.left = `calc(${width}px + var(--spacing-lg))`;
    }

    function createThemeToggleButton() {
        if (document.getElementById('theme-toggle')) return;

        const btn = document.createElement('button');
        btn.id = 'theme-toggle';
        btn.type = 'button';

        // Check if we're on employee portal (has bottom-nav)
        const bottomNav = document.querySelector('.bottom-nav');
        
        if (bottomNav) {
            // Employee portal: integrate into bottom nav
            btn.className = 'nav-item theme-toggle-nav';
            btn.style.cssText = `
                background: transparent;
                border: none;
                color: var(--text-muted);
                text-align: center;
                text-decoration: none;
                font-size: 0.75rem;
                font-weight: 500;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.25rem;
                cursor: pointer;
                padding: 0;
                -webkit-tap-highlight-color: transparent;
            `;
            
            const updateContent = () => {
                const isLight = document.documentElement.classList.contains('theme-light');
                btn.innerHTML = isLight 
                    ? '<span style="font-size: 1.75rem; line-height: 1;">🌙</span><small>Oscuro</small>' 
                    : '<span style="font-size: 1.75rem; line-height: 1;">☀️</span><small>Claro</small>';
            };
            
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const isLight = document.documentElement.classList.contains('theme-light');
                applyTheme(isLight ? THEME_DARK : THEME_LIGHT, { persist: true });
                updateContent();
            });
            
            updateContent();
            bottomNav.appendChild(btn);
            return;
        }

        // Default button setup for other pages
        btn.className = 'btn btn-secondary theme-toggle';

        btn.addEventListener('click', () => {
            const isLight = document.documentElement.classList.contains('theme-light');
            applyTheme(isLight ? THEME_DARK : THEME_LIGHT, { persist: true });
        });

        // If the app sidebar exists (admin views), place the toggle above the logout button.
        const logoutBtn = document.querySelector('.sidebar button[onclick="logout()"]');
        if (logoutBtn && logoutBtn.parentElement) {
            btn.classList.add('theme-toggle--sidebar');
            btn.style.width = '100%';
            btn.style.marginBottom = 'var(--spacing-md)';
            logoutBtn.parentElement.insertBefore(btn, logoutBtn);

            // Sync initial icon/label
            const currentIsLight = document.documentElement.classList.contains('theme-light');
            applyTheme(currentIsLight ? THEME_LIGHT : THEME_DARK, { persist: false });
            return;
        }

        positionThemeToggleButton(btn);
        window.addEventListener('resize', () => positionThemeToggleButton(btn));

        document.body.appendChild(btn);

        // Sync initial icon/label
        const currentIsLight = document.documentElement.classList.contains('theme-light');
        applyTheme(currentIsLight ? THEME_LIGHT : THEME_DARK, { persist: false });
    }

    function normalizeText(value) {
        return (typeof value === 'string' ? value : '').trim();
    }

    function applyCompanyNameToSidebar(companyName) {
        const name = normalizeText(companyName);
        if (!name) return;

        const container = document.querySelector('.sidebar-logo');
        if (!container) return;

        const spans = container.querySelectorAll('span');
        // Pattern in app: <span>👥</span><span>Gestión RH</span>
        if (spans.length >= 2) {
            spans[spans.length - 1].textContent = name;
            return;
        }

        if (spans.length === 1) {
            // Ensure there is a text span
            const textSpan = document.createElement('span');
            textSpan.textContent = name;
            container.appendChild(textSpan);
            return;
        }

        // No spans found; fallback to setting text content
        container.textContent = name;
    }

    function applyCompanyLogoToLogin(logoBase64) {
        const logo = normalizeText(logoBase64);
        if (!logo) return;

        const logoBox = document.querySelector('.login-header .logo');
        if (!logoBox) return;

        let img = logoBox.querySelector('img[data-company-logo="true"]');
        if (!img) {
            logoBox.textContent = '';
            img = document.createElement('img');
            img.setAttribute('data-company-logo', 'true');
            img.alt = 'Logo';
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.display = 'block';
            logoBox.appendChild(img);
        }

        img.src = logo;
    }


    function applyCompanyLogoToSidebar(logoBase64) {
        const logo = normalizeText(logoBase64);
        if (!logo) return;

        const container = document.querySelector('.sidebar-logo');
        if (!container) return;

        // Hide the original emoji/icon span if present (keep text)
        const firstSpan = container.querySelector('span');
        if (firstSpan) {
            firstSpan.style.display = 'none';
        }

        let img = container.querySelector('img[data-company-logo="true"]');
        if (!img) {
            img = document.createElement('img');
            img.setAttribute('data-company-logo', 'true');
            img.alt = 'Logo';
            img.style.height = '30px';
            img.style.width = 'auto';
            img.style.maxWidth = '30px';
            img.style.objectFit = 'contain';
            img.style.display = 'block';

            container.insertBefore(img, container.firstChild);
        }

        img.src = logo;
    }

    function applyCompanyBrandingToEmployeeHeader(companyName, logoBase64) {
        const name = normalizeText(companyName);
        const logo = normalizeText(logoBase64);

        // 1) Mobile header (employee-dashboard)
        const header = document.querySelector('.header-mobile');
        if (header) {
            const welcome = header.querySelector('.welcome-text') || header;
            let brandRow = welcome.querySelector('[data-company-branding="true"]');

            if (!brandRow) {
                brandRow = document.createElement('div');
                brandRow.setAttribute('data-company-branding', 'true');
                brandRow.style.display = 'flex';
                brandRow.style.alignItems = 'center';
                brandRow.style.gap = '0.5rem';
                brandRow.style.marginBottom = '0.5rem';

                if (welcome.firstChild) {
                    welcome.insertBefore(brandRow, welcome.firstChild);
                } else {
                    welcome.appendChild(brandRow);
                }
            }

            let img = brandRow.querySelector('img[data-company-logo="true"]');
            if (logo) {
                if (!img) {
                    img = document.createElement('img');
                    img.setAttribute('data-company-logo', 'true');
                    img.alt = 'Logo';
                    img.style.height = '28px';
                    img.style.width = 'auto';
                    img.style.maxWidth = '80px';
                    img.style.objectFit = 'contain';
                    brandRow.appendChild(img);
                }
                img.src = logo;
            } else if (img) {
                img.remove();
            }

            let nameEl = brandRow.querySelector('[data-company-name="true"]');
            if (name) {
                if (!nameEl) {
                    nameEl = document.createElement('span');
                    nameEl.setAttribute('data-company-name', 'true');
                    nameEl.style.fontSize = '0.875rem';
                    nameEl.style.fontWeight = '600';
                    nameEl.style.color = 'var(--text-muted)';
                    brandRow.appendChild(nameEl);
                }
                nameEl.textContent = name;
            } else if (nameEl) {
                nameEl.remove();
            }

            return;
        }

        // 2) Other employee pages: insert a small brand row before the first H1
        const h1 = document.querySelector('h1');
        if (!h1) return;

        let brandRow = document.querySelector('[data-company-branding="true"]');
        if (!brandRow) {
            brandRow = document.createElement('div');
            brandRow.setAttribute('data-company-branding', 'true');
            brandRow.style.display = 'flex';
            brandRow.style.alignItems = 'center';
            brandRow.style.gap = '0.5rem';
            brandRow.style.marginBottom = '0.75rem';

            h1.parentNode.insertBefore(brandRow, h1);
        }

        let img = brandRow.querySelector('img[data-company-logo="true"]');
        if (logo) {
            if (!img) {
                img = document.createElement('img');
                img.setAttribute('data-company-logo', 'true');
                img.alt = 'Logo';
                img.style.height = '24px';
                img.style.width = 'auto';
                img.style.maxWidth = '80px';
                img.style.objectFit = 'contain';
                brandRow.appendChild(img);
            }
            img.src = logo;
        } else if (img) {
            img.remove();
        }

        let nameEl = brandRow.querySelector('[data-company-name="true"]');
        if (name) {
            if (!nameEl) {
                nameEl = document.createElement('span');
                nameEl.setAttribute('data-company-name', 'true');
                nameEl.style.fontSize = '0.875rem';
                nameEl.style.fontWeight = '600';
                nameEl.style.color = 'var(--text-muted)';
                brandRow.appendChild(nameEl);
            }
            nameEl.textContent = name;
        } else if (nameEl) {
            nameEl.remove();
        }
    }

    function applyCompanyBranding(settings) {
        if (!settings) return;

        const companyName = settings.company_name;
        const logoBase64 = settings.logo_base64;

        // Login screen
        if (document.querySelector('.login-header .logo')) {
            applyCompanyLogoToLogin(logoBase64);
            return;
        }

        // Admin/app layout: sidebar present
        if (document.querySelector('.sidebar')) {
            applyCompanyNameToSidebar(companyName);
            applyCompanyLogoToSidebar(logoBase64);
            return;
        }

        // Employee portal layout (no sidebar)
        applyCompanyBrandingToEmployeeHeader(companyName, logoBase64);
    }

    async function fetchSettings() {
        if (typeof API_URL === 'undefined') return null;

        // GET /settings is public in the backend, so we avoid auth/logout side effects.
        const response = await fetch(`${API_URL}/settings`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) return null;
        return response.json();
    }

    async function loadAndApplyCompanyBranding() {
        const settings = await fetchSettings();
        if (!settings) return;

        applyCompanyBranding(settings);
    }

    // Expose small API so settings page can reuse
    window.applyCompanyBranding = applyCompanyBranding;
    window.loadAndApplyCompanyBranding = loadAndApplyCompanyBranding;

    // Apply theme as early as possible to reduce flicker.
    applyTheme(getInitialTheme(), { persist: false });

    document.addEventListener('DOMContentLoaded', () => {
        createThemeToggleButton();
        // Don’t block page load; fire and forget.
        loadAndApplyCompanyBranding().catch(() => { /* no-op */ });
    });
})();
