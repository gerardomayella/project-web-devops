document.addEventListener('DOMContentLoaded', () => {
    // Auth Elements
    const authModal = document.getElementById('auth-modal');
    const btnShowAuth = document.getElementById('btn-show-auth');
    const btnCloseAuth = document.getElementById('btn-close-auth');
    const btnLockLoginTrigger = document.getElementById('btn-lock-login-trigger');
    
    const tabLoginBtn = document.getElementById('tab-login-btn');
    const tabSignupBtn = document.getElementById('tab-signup-btn');
    const formLogin = document.getElementById('form-login');
    const formSignup = document.getElementById('form-signup');
    
    const loginUsernameInput = document.getElementById('login-username');
    const loginPasswordInput = document.getElementById('login-password');
    const loginErrorMsg = document.getElementById('login-error-msg');
    
    const signupUsernameInput = document.getElementById('signup-username');
    const signupEmailInput = document.getElementById('signup-email');
    const signupPasswordInput = document.getElementById('signup-password');
    const signupErrorMsg = document.getElementById('signup-error-msg');
    const signupSuccessMsg = document.getElementById('signup-success-msg');
    
    const userProfileBadge = document.getElementById('user-profile-badge');
    const navUsername = document.getElementById('nav-username');
    const btnLogout = document.getElementById('btn-logout');
    const dashboardLockOverlay = document.getElementById('dashboard-lock-overlay');

    // Dashboard Telemetry Elements
    const systemBadge = document.getElementById('system-badge');
    const dbStatusVal = document.getElementById('db-status-val');
    const dbLatencyMeta = document.getElementById('db-latency-meta');
    const dbBar = document.getElementById('db-bar');
    
    const uptimeVal = document.getElementById('uptime-val');
    const nodePlatform = document.getElementById('node-platform');
    
    const memVal = document.getElementById('mem-val');
    const memPctMeta = document.getElementById('mem-pct-meta');
    const memBar = document.getElementById('mem-bar');
    const rssVal = document.getElementById('rss-val');
    
    const btnDiagnostic = document.getElementById('btn-diagnostic');
    const diagnosticsBox = document.getElementById('diagnostics-box');
    const diagLog = document.getElementById('diag-log');
    const btnCloseDiag = document.getElementById('btn-close-diag');

    let pollIntervalId = null;
    let isRunningDiag = false;

    // Helper: Set cookie
    function setCookie(name, value, days) {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax; Secure";
    }

    // Helper: Get cookie
    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    // Helper: Erase cookie
    function eraseCookie(name) {
        document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    }

    // Helper: Get token and headers
    function getAuthHeaders() {
        const token = localStorage.getItem('hexa_token') || getCookie('hexa_token');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    // Helper to format uptime (seconds to hh:mm:ss)
    function formatUptime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const pad = (num) => String(num).padStart(2, '0');
        return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    }

    // Update UI State based on Authentication
    function updateUIState() {
        let token = localStorage.getItem('hexa_token');
        let username = localStorage.getItem('hexa_username');

        // Check cache in cookie if localStorage is empty (e.g. cookies backup)
        if (!token || !username) {
            token = getCookie('hexa_token');
            username = getCookie('hexa_username');
            if (token && username) {
                localStorage.setItem('hexa_token', token);
                localStorage.setItem('hexa_username', username);
            }
        }

        if (token && username) {
            // Logged In
            btnShowAuth.style.display = 'none';
            userProfileBadge.style.display = 'flex';
            navUsername.textContent = username;
            dashboardLockOverlay.style.opacity = '0';
            setTimeout(() => {
                dashboardLockOverlay.style.visibility = 'hidden';
            }, 400);

            // Start polling if not already started
            if (!pollIntervalId) {
                updateDashboard();
                pollIntervalId = setInterval(updateDashboard, 3000);
            }
        } else {
            // Logged Out
            btnShowAuth.style.display = 'inline-flex';
            userProfileBadge.style.display = 'none';
            navUsername.textContent = '';
            dashboardLockOverlay.style.visibility = 'visible';
            dashboardLockOverlay.style.opacity = '1';

            // Clear polling
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
            }

            // Reset dashboard state
            uptimeVal.textContent = '00h 00m 00s';
            memVal.textContent = '-- MB';
            memPctMeta.textContent = 'Heap Memory Allocation';
            memBar.style.width = '0%';
            dbStatusVal.textContent = 'Locked';
            dbStatusVal.style.color = 'var(--text-muted)';
            dbLatencyMeta.textContent = 'Ping latency: -- ms';
            dbBar.style.width = '0%';
            diagnosticsBox.style.display = 'none';
        }
    }

    // Fetch status from API
    async function updateDashboard() {
        if (!localStorage.getItem('hexa_token')) return;
        
        try {
            const res = await fetch('/api/status', {
                headers: getAuthHeaders()
            });
            
            if (res.status === 401 || res.status === 403) {
                // Token invalid/expired
                handleLogout();
                return;
            }
            
            if (!res.ok) throw new Error('Server returned error status');
            const data = await res.json();
            
            // Server badge
            systemBadge.classList.remove('error');
            systemBadge.querySelector('.badge-text').textContent = 'Server Online';

            // Uptime
            uptimeVal.textContent = formatUptime(data.uptime);
            nodePlatform.textContent = `${data.system.platform} ${data.system.arch}`;

            // Memory
            const heapUsedMB = (data.memory.heapUsed / 1024 / 1024).toFixed(1);
            const heapTotalMB = (data.memory.heapTotal / 1024 / 1024).toFixed(1);
            const rssMB = (data.memory.rss / 1024 / 1024).toFixed(1);
            
            memVal.textContent = `${heapUsedMB} MB`;
            const memPct = Math.min(100, Math.round((data.memory.heapUsed / data.memory.heapTotal) * 100));
            memPctMeta.textContent = `Heap Used: ${memPct}% of ${heapTotalMB} MB Allocated`;
            memBar.style.width = `${memPct}%`;
            rssVal.textContent = `${rssMB} MB`;

            // Database status
            if (data.database.connected) {
                dbStatusVal.textContent = 'Connected';
                dbStatusVal.style.color = '#10B981'; // Green
                dbLatencyMeta.textContent = `Response time: ${data.database.latency} ms`;
                dbBar.style.width = '100%';
                dbBar.style.backgroundColor = '#10B981';
            } else {
                dbStatusVal.textContent = 'Disconnected';
                dbStatusVal.style.color = '#EF4444'; // Red
                dbLatencyMeta.textContent = `Error: Database offline`;
                dbBar.style.width = '20%';
                dbBar.style.backgroundColor = '#EF4444';
            }

        } catch (error) {
            console.error('Failed to fetch status:', error);
            systemBadge.classList.add('error');
            systemBadge.querySelector('.badge-text').textContent = 'Server Offline';
            
            dbStatusVal.textContent = 'Offline';
            dbStatusVal.style.color = '#EF4444';
            dbLatencyMeta.textContent = 'Cannot reach API';
            dbBar.style.width = '0%';
        }
    }

    // Run database diagnostic
    async function runDiagnostics() {
        if (isRunningDiag) return;
        isRunningDiag = true;
        
        diagnosticsBox.style.display = 'block';
        diagLog.textContent = '';
        btnDiagnostic.disabled = true;

        const writeLog = (text, delay = 0) => {
            return new Promise(resolve => {
                setTimeout(() => {
                    diagLog.textContent += text + '\n';
                    diagnosticsBox.scrollTop = diagnosticsBox.scrollHeight;
                    resolve();
                }, delay);
            });
        };

        await writeLog('🚀 [INIT] Starting HexaObserve protected diagnostics...', 100);
        await writeLog('🔑 [AUTH] Attaching security credentials token...', 200);
        await writeLog('🔌 [TCP] Dispatching handshake connection test query...', 300);
        
        try {
            const start = performance.now();
            const res = await fetch('/test-db', {
                headers: getAuthHeaders()
            });

            if (res.status === 401 || res.status === 403) {
                await writeLog('❌ [ERROR] Authentication rejected! Logging out...', 100);
                setTimeout(handleLogout, 1500);
                return;
            }

            const latency = Math.round(performance.now() - start);
            const data = await res.json();
            
            if (res.ok && data.status === 'SUKSES') {
                await writeLog('✅ [TCP] Connection check success.', 200);
                await writeLog(`⏱️  [PING] Database latency roundtrip: ${latency} ms`, 100);
                await writeLog(`📅 [PG_TIME] Database server clock: ${data.waktu_server_pg}`, 200);
                
                await writeLog('\n🎉 [COMPLETE] Diagnostic sequence finished successfully.', 400);
            } else {
                throw new Error(data.pesan || 'Database check failed');
            }
        } catch (err) {
            await writeLog('❌ [ERROR] Connection handshake failed!', 200);
            await writeLog(`💥 [DETAILS] ${err.message}`, 100);
        }

        btnDiagnostic.disabled = false;
        isRunningDiag = false;
        updateDashboard();
    }

    // Auth Actions: Open/Close Modal
    function showModal() {
        authModal.style.display = 'flex';
        switchTab('login');
    }

    function closeModal() {
        authModal.style.display = 'none';
        clearFormErrors();
    }

    function switchTab(tab) {
        clearFormErrors();
        if (tab === 'login') {
            tabLoginBtn.classList.add('active');
            tabSignupBtn.classList.remove('active');
            formLogin.style.display = 'flex';
            formSignup.style.display = 'none';
        } else {
            tabLoginBtn.classList.remove('active');
            tabSignupBtn.classList.add('active');
            formLogin.style.display = 'none';
            formSignup.style.display = 'flex';
        }
    }

    function clearFormErrors() {
        loginErrorMsg.style.display = 'none';
        loginErrorMsg.textContent = '';
        signupErrorMsg.style.display = 'none';
        signupErrorMsg.textContent = '';
        signupSuccessMsg.style.display = 'none';
        signupSuccessMsg.textContent = '';
        
        loginUsernameInput.value = '';
        loginPasswordInput.value = '';
        signupUsernameInput.value = '';
        signupEmailInput.value = '';
        signupPasswordInput.value = '';
    }

    function handleLogout() {
        localStorage.removeItem('hexa_token');
        localStorage.removeItem('hexa_username');
        eraseCookie('hexa_token');
        eraseCookie('hexa_username');
        updateUIState();
    }

    // Submit Handlers
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginErrorMsg.style.display = 'none';
        
        const username = loginUsernameInput.value.trim();
        const password = loginPasswordInput.value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await res.json();
            if (!res.ok || data.status === 'ERROR') {
                throw new Error(data.pesan || 'Login failed');
            }
            
            // Save token to localStorage and Cookie cache (expires in 1 day)
            localStorage.setItem('hexa_token', data.token);
            localStorage.setItem('hexa_username', data.user.username);
            setCookie('hexa_token', data.token, 1);
            setCookie('hexa_username', data.user.username, 1);
            
            closeModal();
            updateUIState();
        } catch (err) {
            loginErrorMsg.textContent = err.message;
            loginErrorMsg.style.display = 'block';
        }
    });

    formSignup.addEventListener('submit', async (e) => {
        e.preventDefault();
        signupErrorMsg.style.display = 'none';
        signupSuccessMsg.style.display = 'none';
        
        const username = signupUsernameInput.value.trim();
        const email = signupEmailInput.value.trim();
        const password = signupPasswordInput.value;

        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            
            const data = await res.json();
            if (!res.ok || data.status === 'ERROR') {
                throw new Error(data.pesan || 'Registration failed');
            }
            
            signupSuccessMsg.textContent = 'Account created successfully! Switching to Login...';
            signupSuccessMsg.style.display = 'block';
            
            // Clear signup inputs
            signupUsernameInput.value = '';
            signupEmailInput.value = '';
            signupPasswordInput.value = '';
            
            // Redirect to login tab after 1.5s
            setTimeout(() => {
                switchTab('login');
            }, 1500);

        } catch (err) {
            signupErrorMsg.textContent = err.message;
            signupErrorMsg.style.display = 'block';
        }
    });

    // Event listeners
    btnShowAuth.addEventListener('click', showModal);
    btnLockLoginTrigger.addEventListener('click', showModal);
    btnCloseAuth.addEventListener('click', closeModal);
    
    tabLoginBtn.addEventListener('click', () => switchTab('login'));
    tabSignupBtn.addEventListener('click', () => switchTab('signup'));
    
    btnLogout.addEventListener('click', handleLogout);
    btnDiagnostic.addEventListener('click', runDiagnostics);
    btnCloseDiag.addEventListener('click', () => {
        diagnosticsBox.style.display = 'none';
    });

    // Close modal clicking outside card
    authModal.addEventListener('click', (e) => {
        if (e.target === authModal) closeModal();
    });

    // Init UI State
    updateUIState();
});
