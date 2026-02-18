const API_URL = 'https://opensky-network.org/api/states/all';
const UPDATE_INTERVAL = 15000;

let map;
let currentTileLayer;
let markers = {};
let airplaneData = [];
let countries = new Set();
let selectedCountries = new Set();
let flightTrails = {};
let isAutoRefresh = true;
let refreshIntervalId = null;
let showTrails = false;
let enableClustering = false;
let clusterGroup = null;
let minAltitude = 0;
let maxAltitude = 50000;
let minSpeed = 0;
let maxSpeed = 700;
let searchQuery = '';
let showOnlyOnGround = false;
let showOnlyInAir = false;
let darkMode = false;
let selectedAircraftType = 'all';
let sortBy = 'altitude-desc';

const tileLayers = {
    'OpenStreetMap': {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors'
    },
    'Dark Matter': {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '© OpenStreetMap contributors, © CARTO'
    },
    'Satellite': {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri'
    },
    'Light Gray': {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '© OpenStreetMap contributors, © CARTO'
    },
    'Topographic': {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors, © OpenTopoMap'
    },
    'Transport': {
        url: 'https://{s}.tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=6170aad10dfd42a38d4d8c709a536f38',
        attribution: '© OpenStreetMap contributors, © Thunderforest'
    }
};

const aircraftTypes = {
    'all': 'All Types',
    'commercial': 'Commercial',
    'private': 'Private/Small',
    'cargo': 'Cargo'
};

function initMap() {
    map = L.map('map').setView([42.6687244047767, 21.156714562994324], 13);
    
    currentTileLayer = L.tileLayer(tileLayers['OpenStreetMap'].url, {
        maxZoom: 19,
        attribution: tileLayers['OpenStreetMap'].attribution
    }).addTo(map);
}

function switchTileLayer(layerName) {
    if (currentTileLayer) {
        map.removeLayer(currentTileLayer);
    }
    
    currentTileLayer = L.tileLayer(tileLayers[layerName].url, {
        maxZoom: 19,
        attribution: tileLayers[layerName].attribution
    }).addTo(map);
    
    currentTileLayer.bringToBack();
}

function createAirplaneIcon(heading, isSelected = false) {
    const rotation = heading || 0;
    const color = isSelected ? '#ef4444' : '#3b82f6';
    
    return L.divIcon({
        className: 'airplane-icon',
        html: `<div style="transform: rotate(${rotation}deg); width: 24px; height: 24px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${color}" stroke="white" stroke-width="1"/>
            </svg>
        </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });
}

function createPopupContent(state) {
    const icao24 = state[0];
    const callsign = state[1]?.trim() || 'N/A';
    const country = state[2] || 'Unknown';
    const longitude = state[5]?.toFixed(4) || 'N/A';
    const latitude = state[6]?.toFixed(4) || 'N/A';
    const altitude = state[7] ? (state[7] * 3.28084).toFixed(0) : 'N/A';
    const onGround = state[8] ? 'Yes' : 'No';
    const velocity = state[9] ? (state[9] * 2.23694).toFixed(0) : 'N/A';
    const heading = state[10]?.toFixed(0) || 'N/A';
    const verticalRate = state[11] ? (state[11] * 196.85).toFixed(0) : 'N/A';
    const squawk = state[14] || 'N/A';
    
    return `
        <div class="popup-content">
            <div class="popup-header">
                <strong>✈️ ${callsign}</strong>
                <span class="icao-badge">${icao24}</span>
            </div>
            <div class="popup-grid">
                <div><span class="label">Country:</span> <span class="value">${country}</span></div>
                <div><span class="label">Altitude:</span> <span class="value">${altitude.toLocaleString()} ft</span></div>
                <div><span class="label">Speed:</span> <span class="value">${velocity} mph</span></div>
                <div><span class="label">Heading:</span> <span class="value">${heading}°</span></div>
                <div><span class="label">Position:</span> <span class="value">${latitude}, ${longitude}</span></div>
                <div><span class="label">Vertical Rate:</span> <span class="value">${verticalRate} ft/min</span></div>
                <div><span class="label">On Ground:</span> <span class="value">${onGround}</span></div>
                <div><span class="label">Squawk:</span> <span class="value">${squawk}</span></div>
            </div>
            <div class="popup-actions">
                <button onclick="trackAircraft('${icao24}')">📡 Track</button>
                <button onclick="showFlightPath('${icao24}')">📍 Path</button>
                <button onclick="copyInfo('${icao24}', '${callsign}')">📋 Copy</button>
            </div>
        </div>
    `;
}

async function fetchAirplaneData() {
    try {
        const response = await fetch(API_URL);
        const data = await response.json();
        return data.states || [];
    } catch (error) {
        console.error('Error fetching airplane data:', error);
        return [];
    }
}

function extractCountries(states) {
    countries.clear();
    states.forEach(state => {
        if (state[2]) {
            countries.add(state[2]);
        }
    });
    return Array.from(countries).sort();
}

function countAirplanesByCountry(states) {
    const counts = {};
    states.forEach(state => {
        const country = state[2] || 'Unknown';
        counts[country] = (counts[country] || 0) + 1;
    });
    return counts;
}

function filterAirplanes(states) {
    return states.filter(state => {
        const country = state[2] || 'Unknown';
        const altitude = state[7] ? (state[7] * 3.28084) : 0;
        const velocity = state[9] ? (state[9] * 2.23694) : 0;
        const callsign = state[1]?.trim() || '';
        const onGround = state[8];
        
        if (!selectedCountries.has(country)) return false;
        if (altitude < minAltitude || altitude > maxAltitude) return false;
        if (velocity < minSpeed || velocity > maxSpeed) return false;
        if (searchQuery && !callsign.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (showOnlyOnGround && !onGround) return false;
        if (showOnlyInAir && onGround) return false;
        
        return true;
    });
}

function sortAirplanes(states) {
    return states.sort((a, b) => {
        switch(sortBy) {
            case 'altitude-desc':
                return (b[7] || 0) - (a[7] || 0);
            case 'altitude-asc':
                return (a[7] || 0) - (b[7] || 0);
            case 'speed-desc':
                return (b[9] || 0) - (a[9] || 0);
            case 'speed-asc':
                return (a[9] || 0) - (b[9] || 0);
            case 'callsign':
                return (a[1] || '').localeCompare(b[1] || '');
            default:
                return 0;
        }
    });
}

function createSidebarContent() {
    const container = document.getElementById('sidebar-content');
    
    container.innerHTML = `
        <div class="sidebar-section">
            <h3><span class="icon">🗺️</span> Map Style</h3>
            <div class="tile-layer-options">
                ${Object.keys(tileLayers).map(name => `
                    <label class="radio-option">
                        <input type="radio" name="tile-layer" value="${name}" ${name === 'OpenStreetMap' ? 'checked' : ''}>
                        <span>${name}</span>
                    </label>
                `).join('')}
            </div>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">🔍</span> Search</h3>
            <input type="text" id="search-callsign" placeholder="Search callsign..." class="search-input">
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">📊</span> Quick Stats</h3>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-value" id="total-planes">0</span>
                    <span class="stat-label">Total Planes</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" id="visible-planes">0</span>
                    <span class="stat-label">Visible</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" id="avg-altitude">0</span>
                    <span class="stat-label">Avg Alt (ft)</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" id="avg-speed">0</span>
                    <span class="stat-label">Avg Speed</span>
                </div>
            </div>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">🎚️</span> Altitude Filter</h3>
            <div class="range-container">
                <label>Min: <span id="min-alt-display">0</span> ft</label>
                <input type="range" id="min-altitude" min="0" max="50000" value="0" step="1000">
            </div>
            <div class="range-container">
                <label>Max: <span id="max-alt-display">50000</span> ft</label>
                <input type="range" id="max-altitude" min="0" max="50000" value="50000" step="1000">
            </div>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">⚡</span> Speed Filter</h3>
            <div class="range-container">
                <label>Min: <span id="min-speed-display">0</span> mph</label>
                <input type="range" id="min-speed" min="0" max="700" value="0" step="10">
            </div>
            <div class="range-container">
                <label>Max: <span id="max-speed-display">700</span> mph</label>
                <input type="range" id="max-speed" min="0" max="700" value="700" step="10">
            </div>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">🌍</span> Countries</h3>
            <div class="filter-buttons">
                <button id="select-all-countries" class="small-btn">Select All</button>
                <button id="deselect-all-countries" class="small-btn">Deselect All</button>
            </div>
            <div id="country-list">
                <p class="loading-text">Loading countries...</p>
            </div>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">📍</span> Status Filter</h3>
            <label class="checkbox-option">
                <input type="checkbox" id="show-on-ground">
                <span>Show only on ground</span>
            </label>
            <label class="checkbox-option">
                <input type="checkbox" id="show-in-air">
                <span>Show only in air</span>
            </label>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">📋</span> Sort By</h3>
            <select id="sort-select" class="select-input">
                <option value="altitude-desc">Altitude (High to Low)</option>
                <option value="altitude-asc">Altitude (Low to High)</option>
                <option value="speed-desc">Speed (Fast to Slow)</option>
                <option value="speed-asc">Speed (Slow to Fast)</option>
                <option value="callsign">Callsign (A-Z)</option>
            </select>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">⚙️</span> Display Options</h3>
            <label class="toggle-option">
                <input type="checkbox" id="auto-refresh" checked>
                <span class="toggle-slider"></span>
                <span class="toggle-label">Auto Refresh</span>
            </label>
            <label class="toggle-option">
                <input type="checkbox" id="show-trails">
                <span class="toggle-slider"></span>
                <span class="toggle-label">Flight Trails</span>
            </label>
            <label class="toggle-option">
                <input type="checkbox" id="enable-clustering">
                <span class="toggle-slider"></span>
                <span class="toggle-label">Cluster Markers</span>
            </label>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">🎨</span> Appearance</h3>
            <label class="toggle-option">
                <input type="checkbox" id="dark-mode">
                <span class="toggle-slider"></span>
                <span class="toggle-label">Dark Mode</span>
            </label>
        </div>

        <div class="sidebar-section">
            <h3><span class="icon">🎛️</span> Actions</h3>
            <button id="refresh-now" class="action-btn primary">🔄 Refresh Now</button>
            <button id="export-data" class="action-btn">📥 Export Data</button>
            <button id="clear-trails" class="action-btn">🗑️ Clear Trails</button>
            <button id="reset-filters" class="action-btn">♻️ Reset All Filters</button>
        </div>
    `;
    
    setupEventListeners();
}

function setupEventListeners() {
    document.querySelectorAll('input[name="tile-layer"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                switchTileLayer(e.target.value);
            }
        });
    });

    const searchInput = document.getElementById('search-callsign');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            updateMarkers();
        });
    }

    const minAltSlider = document.getElementById('min-altitude');
    const maxAltSlider = document.getElementById('max-altitude');
    
    if (minAltSlider) {
        minAltSlider.addEventListener('input', (e) => {
            minAltitude = parseInt(e.target.value);
            document.getElementById('min-alt-display').textContent = minAltitude;
            updateMarkers();
        });
    }
    
    if (maxAltSlider) {
        maxAltSlider.addEventListener('input', (e) => {
            maxAltitude = parseInt(e.target.value);
            document.getElementById('max-alt-display').textContent = maxAltitude;
            updateMarkers();
        });
    }

    const minSpeedSlider = document.getElementById('min-speed');
    const maxSpeedSlider = document.getElementById('max-speed');
    
    if (minSpeedSlider) {
        minSpeedSlider.addEventListener('input', (e) => {
            minSpeed = parseInt(e.target.value);
            document.getElementById('min-speed-display').textContent = minSpeed;
            updateMarkers();
        });
    }
    
    if (maxSpeedSlider) {
        maxSpeedSlider.addEventListener('input', (e) => {
            maxSpeed = parseInt(e.target.value);
            document.getElementById('max-speed-display').textContent = maxSpeed;
            updateMarkers();
        });
    }

    const onGroundCheckbox = document.getElementById('show-on-ground');
    const inAirCheckbox = document.getElementById('show-in-air');
    
    if (onGroundCheckbox) {
        onGroundCheckbox.addEventListener('change', (e) => {
            showOnlyOnGround = e.target.checked;
            if (showOnlyOnGround) {
                showOnlyInAir = false;
                if (inAirCheckbox) inAirCheckbox.checked = false;
            }
            updateMarkers();
        });
    }
    
    if (inAirCheckbox) {
        inAirCheckbox.addEventListener('change', (e) => {
            showOnlyInAir = e.target.checked;
            if (showOnlyInAir) {
                showOnlyOnGround = false;
                if (onGroundCheckbox) onGroundCheckbox.checked = false;
            }
            updateMarkers();
        });
    }

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            sortBy = e.target.value;
            updateMarkers();
        });
    }

    const autoRefreshToggle = document.getElementById('auto-refresh');
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', (e) => {
            isAutoRefresh = e.target.checked;
            if (isAutoRefresh) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });
    }

    const trailsToggle = document.getElementById('show-trails');
    if (trailsToggle) {
        trailsToggle.addEventListener('change', (e) => {
            showTrails = e.target.checked;
            if (!showTrails) {
                clearAllTrails();
            }
        });
    }

    const clusteringToggle = document.getElementById('enable-clustering');
    if (clusteringToggle) {
        clusteringToggle.addEventListener('change', (e) => {
            enableClustering = e.target.checked;
            updateMarkers();
        });
    }

    const darkModeToggle = document.getElementById('dark-mode');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', (e) => {
            darkMode = e.target.checked;
            document.body.classList.toggle('dark-mode', darkMode);
        });
    }

    const selectAllBtn = document.getElementById('select-all-countries');
    const deselectAllBtn = document.getElementById('deselect-all-countries');
    
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            countries.forEach(country => selectedCountries.add(country));
            document.querySelectorAll('#country-list input[type="checkbox"]').forEach(cb => {
                cb.checked = true;
            });
            updateMarkers();
        });
    }
    
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            selectedCountries.clear();
            document.querySelectorAll('#country-list input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            updateMarkers();
        });
    }

    const refreshNowBtn = document.getElementById('refresh-now');
    if (refreshNowBtn) {
        refreshNowBtn.addEventListener('click', loadData);
    }

    const exportBtn = document.getElementById('export-data');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportData);
    }

    const clearTrailsBtn = document.getElementById('clear-trails');
    if (clearTrailsBtn) {
        clearTrailsBtn.addEventListener('click', clearAllTrails);
    }

    const resetFiltersBtn = document.getElementById('reset-filters');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', resetAllFilters);
    }
}

function updateCountryList(states) {
    const countryList = document.getElementById('country-list');
    const sortedCountries = extractCountries(states);
    const counts = countAirplanesByCountry(states);
    
    if (selectedCountries.size === 0 && sortedCountries.includes("Armenia")) {
        selectedCountries.add("Armenia");
    }
    
    countryList.innerHTML = sortedCountries.map(country => `
        <div class="country-item">
            <input type="checkbox" 
                   id="country-${country.replace(/\s+/g, '-')}" 
                   value="${country}" 
                   ${selectedCountries.has(country) ? 'checked' : ''}>
            <label for="country-${country.replace(/\s+/g, '-')}">${country}</label>
            <span class="count">(${counts[country] || 0})</span>
        </div>
    `).join('');
    
    document.querySelectorAll('#country-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedCountries.add(e.target.value);
            } else {
                selectedCountries.delete(e.target.value);
            }
            updateMarkers();
        });
    });
}

function updateStats(filteredStates, totalStates) {
    const totalPlanes = totalStates.length;
    const visiblePlanes = filteredStates.length;
    
    const avgAltitude = visiblePlanes > 0 
        ? (filteredStates.reduce((sum, s) => sum + (s[7] || 0), 0) / visiblePlanes * 3.28084).toFixed(0)
        : 0;
    
    const avgSpeed = visiblePlanes > 0
        ? (filteredStates.reduce((sum, s) => sum + (s[9] || 0), 0) / visiblePlanes * 2.23694).toFixed(0)
        : 0;
    
    document.getElementById('total-planes').textContent = totalPlanes.toLocaleString();
    document.getElementById('visible-planes').textContent = visiblePlanes.toLocaleString();
    document.getElementById('avg-altitude').textContent = parseInt(avgAltitude).toLocaleString();
    document.getElementById('avg-speed').textContent = avgSpeed;
}

function updateMarkers() {
    const currentIds = new Set();
    let filteredData = filterAirplanes(airplaneData);
    filteredData = sortAirplanes(filteredData);
    
    updateStats(filteredData, airplaneData);
    
    if (enableClustering && !clusterGroup) {
        clusterGroup = L.markerClusterGroup();
        map.addLayer(clusterGroup);
    } else if (!enableClustering && clusterGroup) {
        map.removeLayer(clusterGroup);
        clusterGroup = null;
    }
    
    filteredData.forEach(state => {
        const icao24 = state[0];
        const latitude = state[6];
        const longitude = state[5];
        const heading = state[10] || 0;
        
        if (!latitude || !longitude) return;
        
        currentIds.add(icao24);
        
        if (markers[icao24]) {
            const oldLatLng = markers[icao24].getLatLng();
            markers[icao24].setLatLng([latitude, longitude]);
            markers[icao24].setIcon(createAirplaneIcon(heading));
            markers[icao24].setPopupContent(createPopupContent(state));
            
            if (showTrails) {
                updateTrail(icao24, oldLatLng, [latitude, longitude]);
            }
        } else {
            const marker = L.marker([latitude, longitude], {
                icon: createAirplaneIcon(heading)
            });
            
            marker.bindPopup(createPopupContent(state));
            
            if (enableClustering && clusterGroup) {
                clusterGroup.addLayer(marker);
            } else {
                marker.addTo(map);
            }
            
            markers[icao24] = marker;
        }
    });
    
    Object.keys(markers).forEach(icao24 => {
        if (!currentIds.has(icao24)) {
            if (enableClustering && clusterGroup) {
                clusterGroup.removeLayer(markers[icao24]);
            } else {
                map.removeLayer(markers[icao24]);
            }
            delete markers[icao24];
        }
    });
    
    document.getElementById('airplane-count').textContent = 
        `Showing ${filteredData.length} of ${airplaneData.length} airplanes`;
}

function updateTrail(icao24, from, to) {
    if (!flightTrails[icao24]) {
        flightTrails[icao24] = [];
    }
    
    flightTrails[icao24].push(to);
    
    if (flightTrails[icao24].length > 20) {
        flightTrails[icao24].shift();
    }
    
    if (flightTrails[icao24].length > 1) {
        const polyline = L.polyline(flightTrails[icao24], {
            color: '#3b82f6',
            weight: 2,
            opacity: 0.6
        }).addTo(map);
        
        setTimeout(() => {
            map.removeLayer(polyline);
        }, 60000);
    }
}

function clearAllTrails() {
    flightTrails = {};
}

function exportData() {
    const filteredData = filterAirplanes(airplaneData);
    const exportObj = filteredData.map(state => ({
        icao24: state[0],
        callsign: state[1]?.trim() || '',
        country: state[2],
        longitude: state[5],
        latitude: state[6],
        altitude_feet: state[7] ? (state[7] * 3.28084).toFixed(0) : null,
        on_ground: state[8],
        velocity_mph: state[9] ? (state[9] * 2.23694).toFixed(0) : null,
        heading: state[10],
        vertical_rate: state[11],
        squawk: state[14]
    }));
    
    const dataStr = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `airplanes_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function resetAllFilters() {
    minAltitude = 0;
    maxAltitude = 50000;
    minSpeed = 0;
    maxSpeed = 700;
    searchQuery = '';
    showOnlyOnGround = false;
    showOnlyInAir = false;
    sortBy = 'altitude-desc';
    
    document.getElementById('min-altitude').value = 0;
    document.getElementById('max-altitude').value = 50000;
    document.getElementById('min-speed').value = 0;
    document.getElementById('max-speed').value = 700;
    document.getElementById('search-callsign').value = '';
    document.getElementById('show-on-ground').checked = false;
    document.getElementById('show-in-air').checked = false;
    document.getElementById('sort-select').value = 'altitude-desc';
    document.getElementById('min-alt-display').textContent = '0';
    document.getElementById('max-alt-display').textContent = '50000';
    document.getElementById('min-speed-display').textContent = '0';
    document.getElementById('max-speed-display').textContent = '700';
    
    updateMarkers();
}

function trackAircraft(icao24) {
    const marker = markers[icao24];
    if (marker) {
        map.setView(marker.getLatLng(), 10);
        marker.openPopup();
    }
}

function showFlightPath(icao24) {
    alert(`Flight path history for ${icao24} would be shown here with historical data.`);
}

function copyInfo(icao24, callsign) {
    const text = `Callsign: ${callsign}, ICAO24: ${icao24}`;
    navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
    });
}

async function loadData() {
    airplaneData = await fetchAirplaneData();
    updateCountryList(airplaneData);
    updateMarkers();
}

function startAutoRefresh() {
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
    }
    refreshIntervalId = setInterval(loadData, UPDATE_INTERVAL);
}

function stopAutoRefresh() {
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }
}

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const sidebarCollapsed = document.getElementById('sidebar-collapsed');
    const toggleBtn = document.getElementById('toggle-btn');
    const showSidebarBtn = document.getElementById('show-sidebar');
    
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.add('hidden');
        sidebarCollapsed.classList.remove('hidden');
    });
    
    showSidebarBtn.addEventListener('click', () => {
        sidebar.classList.remove('hidden');
        sidebarCollapsed.classList.add('hidden');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    createSidebarContent();
    setupSidebar();
    loadData();
    startAutoRefresh();
});
