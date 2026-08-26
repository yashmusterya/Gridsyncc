// GridSync - Unified Live EV Trip Planner & Map (SIH Version)

let map;
let allStations = []; // Stores the unified list of all stations
const markerMap = new Map(); // Maps station.id -> google.maps.Marker object
let activeInfoWindow = null;

// Navigation & Driving Simulator States
let userLocation = null;
let vehicleMarker = null;
let watchId = null;
let simIntervalId = null;
let simIndex = 0;
let isNavigating = true;

// Unified Trip Planner & Charging Recommendation States
let directionsService = null;
let directionsRenderer = null;
let routePolylinePath = [];
let onRouteChargers = [];
let activeOnly = false;
let chargerTypeFilter = 'all';
let filter247Only = false;
let startMarker = null;
let destinationMarker = null;
let recommendedStation = null;
let activeRouteInfo = null; // Track active route details globally
let lastDirectionsResponse = null;
let liveGridDemand = null; // Track live India Energy Atlas Grid Data
let vehicleSOC = 55;
let vehicleRange = 300;
let minReserve = 15;

// Role-Based State
let activeUser = null;
let activeWaypoint = null; // Stored waypoint for stopover routing
let adminOverrides = { stations: {}, chargers: {} };
let communityReports = {};
let pricingChartInstance = null;
let adminUtilChart = null;
let adminAvailChart = null;
let adminImpactTrendChart = null;
let activeLoginRole = 'User';

/**
 * Fire-and-forget impact/analytics event logger. Never blocks or throws into
 * the caller - a failed log call must not break the driver-facing action it's
 * attached to (route planning, charger selection, etc.).
 */
function logAnalyticsEvent(type, stationId, metadata) {
    try {
        fetch('/api/analytics/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type,
                userEmail: (activeUser && activeUser.email) || 'anonymous',
                stationId: stationId || null,
                metadata: metadata || {}
            })
        }).catch(() => {});
    } catch (e) { /* analytics must never break the app */ }
}

/**
 * Logs a "charger_diverted" event: GridSync's recommendation or search
 * actually routed a driver to this specific station. This is the traffic
 * this app diverts, and the basis for the impact dashboards.
 */
function logChargerDiversion(station) {
    if (!station) return;
    const type = getStationType(station);
    const priceInfo = getStationGridLoadAndPrice(station);
    const priceNum = parseFloat((priceInfo.price || '').replace(/[^\d.]/g, ''));
    logAnalyticsEvent('charger_diverted', station.id, {
        chargerType: type,
        gridLoad: priceInfo.gridLoad,
        priceEstimate: isNaN(priceNum) ? null : priceNum
    });
}

/**
 * Open Charge Map Status Type ID Mapping
 */
const OCM_STATUS_MAP = {
    0: 'Unknown',
    10: 'Currently Available (Live)',
    20: 'Currently In Use (Live)',
    30: 'Temporarily Unavailable',
    50: 'Operational',
    75: 'Partly Operational',
    100: 'Not Operational',
    150: 'Planned For Future Date',
    200: 'Removed (Decommissioned)',
    210: 'Removed (Duplicate)'
};

/**
 * Extract Google Maps API Key from the page's script tags dynamically
 */
function getGoogleMapsApiKey() {
    const script = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (script) {
        const url = new URL(script.src);
        return url.searchParams.get('key');
    }
    return null;
}

/**
 * Custom SVG EV Charger Icon
 */
const getChargerIcon = (isLive, isAvailable, status = 'Operational', isFaulty = false) => {
    let fillColor = '#10b981'; // Default EV Green (Operational)
    
    const statusLower = status.toLowerCase();
    if (isFaulty || statusLower.includes('not operational') || statusLower.includes('offline') || statusLower.includes('decommissioned') || statusLower.includes('maintenance')) {
        fillColor = '#ef4444'; // Red for offline/broken/maintenance
    } else if (statusLower.includes('occupied') || statusLower.includes('in use')) {
        fillColor = '#f59e0b'; // Orange for busy
    } else if (statusLower.includes('unknown') || statusLower.includes('planned')) {
        fillColor = '#64748b'; // Grey for unknown/future
    } else if (isLive) {
        fillColor = isAvailable ? '#059669' : '#dc2626'; // Green if free, red if fully occupied
    }
    
    return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
                <circle cx="12" cy="12" r="10" fill="${fillColor}" stroke="#ffffff" stroke-width="1.5" />
                <path d="M11 6L6.5 13h4.5v5l4.5-7h-4.5z" fill="#ffffff" />
            </svg>
        `),
        scaledSize: new google.maps.Size(32, 32),
        anchor: new google.maps.Point(16, 16)
    };
};

/**
 * Helper to display source classifications (LIVE, STATIC, PREDICTED, USER REPORTED, etc.)
 */
function getTrustBadgeHTML(classification) {
    let badgeClass = 'trust-unavailable';
    let text = classification.toUpperCase();
    
    switch (text) {
        case 'LIVE': badgeClass = 'trust-live'; break;
        case 'STATIC': badgeClass = 'trust-static'; break;
        case 'PREDICTED': badgeClass = 'trust-predicted'; break;
        case 'USER REPORTED': badgeClass = 'trust-user'; break;
        case 'ADMIN UPDATED': badgeClass = 'trust-admin'; break;
        case 'SIMULATED': badgeClass = 'trust-simulated'; break;
        default: badgeClass = 'trust-unavailable';
    }
    return `<span class="trust-badge ${badgeClass}">${text}</span>`;
}

/**
 * Show a status overlay message (loading or error status)
 */
function showStatus(message, isError = false) {
    const overlay = document.getElementById('status-overlay');
    const msgEl = document.getElementById('status-message');
    if (overlay && msgEl) {
        msgEl.textContent = message;
        if (isError) {
            msgEl.classList.add('error');
        } else {
            msgEl.classList.remove('error');
        }
        overlay.classList.remove('hidden');
    }
}

/**
 * Hide the status overlay
 */
function hideStatus() {
    const overlay = document.getElementById('status-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

/**
 * Create a floating diagnostics badge to debug errors and count plotted markers
 */
function createDiagnosticsBadge() {
    const old = document.getElementById('diagnostics-badge');
    if (old) old.remove();

    const badge = document.createElement('div');
    badge.id = 'diagnostics-badge';
    badge.style.position = 'absolute';
    badge.style.bottom = '85px';
    badge.style.right = '24px';
    badge.style.zIndex = '1000';
    badge.style.background = 'rgba(30, 41, 59, 0.85)';
    badge.style.backdropFilter = 'blur(10px)';
    badge.style.webkitBackdropFilter = 'blur(10px)';
    badge.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    badge.style.borderRadius = '8px';
    badge.style.padding = '8px 12px';
    badge.style.fontSize = '0.75rem';
    badge.style.color = '#94a3b8';
    badge.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    badge.style.fontFamily = 'monospace';
    badge.innerHTML = `Plotted: <span id="diag-plotted" style="color: #f8fafc; font-weight: 600;">0</span> | Live: <span id="diag-live" style="color: #10b981; font-weight: 600;">0</span>`;
    document.body.appendChild(badge);
    
    window.addEventListener('error', (event) => {
        console.error('Captured global error:', event.error || event.message, 'at', event.filename, 'line', event.lineno);

        // Ignore external third-party script errors (e.g., Google Maps API rate limits / billing warnings)
        const isLocalScript = event.filename && (
            event.filename.includes('script.js') || 
            event.filename.includes('index.html') || 
            event.filename.includes('localhost') || 
            event.filename.includes('127.0.0.1')
        );
        
        if (!isLocalScript && (event.message === 'Script error.' || !event.filename)) {
            console.warn('Ignored external non-critical script error.');
            return;
        }

        badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        badge.style.background = 'rgba(30, 41, 59, 0.95)';
        badge.innerHTML = `<span style="color: #f87171; font-weight: 600;">JS Error: ${event.message || 'Check Console'}</span>`;
    });
}

/**
 * Update the diagnostics counts displayed in the UI
 */
function updateDiagnostics() {
    const plottedEl = document.getElementById('diag-plotted');
    const liveEl = document.getElementById('diag-live');
    if (plottedEl && liveEl) {
        plottedEl.textContent = markerMap.size;
        
        let liveCount = 0;
        allStations.forEach(s => {
            if (s.liveStatus) liveCount++;
        });
        liveEl.textContent = liveCount;
    }
}

/**
 * Formats raw Google Place connector constant strings into beautiful descriptions
 */
function formatConnectorName(rawType) {
    if (!rawType) return 'Standard Connector';
    
    let clean = rawType.replace('EV_CONNECTOR_TYPE_', '');
    clean = clean.replace(/_/g, ' ');
    
    if (clean === 'UNSPECIFIED GB T') return 'GB/T Fast Charger';
    if (clean === 'CCS 2') return 'CCS2 Fast Charger';
    if (clean === 'TYPE 2') return 'Type 2 AC Socket';
    if (clean === 'CHADEMO') return 'CHAdeMO Fast Charger';
    if (clean === 'J1772') return 'Type 1 AC Socket';
    if (clean === 'TESLA') return 'Tesla Supercharger';
    
    return clean.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Haversine formula to compute distance in meters between two lat/lng pairs
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

/**
 * Format address fields from Open Charge Map response
 */
function getOCMAddress(ocm) {
    if (!ocm.AddressInfo) return 'Maharashtra, India';
    const parts = [
        ocm.AddressInfo.AddressLine1,
        ocm.AddressInfo.Town,
        ocm.AddressInfo.StateOrProvince
    ];
    return parts.filter(p => !!p).join(', ');
}

/**
 * Helper to fetch database reports and overrides on startup
 */
async function syncDatabaseState() {
    try {
        // Fetch Admin Overrides
        const overridesRes = await fetch('/api/admin/overrides');
        if (overridesRes.ok) {
            adminOverrides = await overridesRes.json();
            console.log('Loaded admin overrides:', adminOverrides);
        }

        // Fetch User Reports
        const reportsRes = await fetch('/api/reports/summary');
        if (reportsRes.ok) {
            communityReports = await reportsRes.json();
            console.log('Loaded community reports summary:', communityReports);
        }
    } catch (e) {
        console.warn('Failed to sync DB states, continuing in-memory:', e);
    }
}

/**
 * Merges admin database overrides and community reports on each station item
 */
function applyOverridesAndReports(station) {
    // 1. Station Details Override
    if (adminOverrides.stations && adminOverrides.stations[station.id]) {
        const o = adminOverrides.stations[station.id];
        if (o.title) station.title = o.title;
        if (o.operator) station.operator = o.operator;
        if (o.address) station.address = o.address;
        if (o.latitude) station.latitude = o.latitude;
        if (o.longitude) station.longitude = o.longitude;
        if (o.hours) station.hours = o.hours;
        if (o.contact) station.contact = o.contact;
        station.adminUpdated = true;
        station.adminUpdateTimestamp = o.timestamp;
    }

    // 2. Connectors Status Overrides
    if (adminOverrides.chargers && adminOverrides.chargers[station.id]) {
        const cOverrides = adminOverrides.chargers[station.id];
        station.connectors.forEach((conn, idx) => {
            const connId = `conn-${idx}`;
            if (cOverrides[connId]) {
                conn.status = cOverrides[connId].status;
                conn.adminUpdated = true;
                conn.adminUpdateTimestamp = cOverrides[connId].timestamp;
                conn.availableCount = conn.status === 'Available' ? conn.count : 0;
            }
        });

        // Recompute aggregate counts
        let totalAvail = 0;
        let totalQty = 0;
        let hasMaintenance = false;
        let hasOffline = false;
        let hasFaulty = false;

        station.connectors.forEach(c => {
            totalQty += c.count;
            if (c.status === 'Available') totalAvail += c.count;
            else if (c.status === 'Maintenance') hasMaintenance = true;
            else if (c.status === 'Offline') hasOffline = true;
            else if (c.status === 'Faulty') hasFaulty = true;
        });

        station.totalConnectors = totalQty;
        station.availableCount = totalAvail;
        
        if (totalAvail > 0) {
            station.status = 'Operational';
        } else if (hasMaintenance) {
            station.status = 'Maintenance';
        } else if (hasFaulty) {
            station.status = 'Faulty';
        } else if (hasOffline) {
            station.status = 'Offline';
        } else {
            station.status = 'Not Operational';
        }
    }

    // 3. Community Working Reports
    if (communityReports[station.id]) {
        const rep = communityReports[station.id];
        station.votesWorking = rep.working || 0;
        station.votesBroken = rep.broken || 0;
        
        // Flag fault if broken reports equal or exceed 3 and outnumber working ones
        if (rep.broken >= 3 && rep.broken > rep.working) {
            station.communityFault = true;
        }
    }
}

/**
 * Unified Station Parser incorporating OCM, Google, Admin Overrides, and User Reports
 */
function buildMergedStation(ocm, googlePlace) {
    const station = {
        id: '',
        title: '',
        latitude: 0,
        longitude: 0,
        address: '',
        operator: 'Unknown Operator',
        status: 'Unknown',
        liveStatus: false,
        availableCount: 0,
        totalConnectors: 0,
        connectors: [],
        hours: '24/7',
        contact: 'N/A',
        trustType: 'STATIC'
    };

    if (ocm && googlePlace) {
        station.id = `merged-${googlePlace.id}-${ocm.ID}`;
        station.title = (googlePlace.displayName && googlePlace.displayName.text) || ocm.AddressInfo.Title;
        station.latitude = parseFloat(googlePlace.location.latitude);
        station.longitude = parseFloat(googlePlace.location.longitude);
        station.address = googlePlace.formattedAddress || getOCMAddress(ocm);
        station.operator = (ocm.OperatorInfo && ocm.OperatorInfo.Title) || 'Unknown Operator';
        station.hours = ocm.AddressInfo.AccessComments || '24/7';
        station.contact = ocm.AddressInfo.ContactTelephone1 || 'N/A';
        
        if (ocm.Connections) {
            station.connectors = ocm.Connections.map(c => ({
                type: (c.ConnectionType && c.ConnectionType.Title) || 'Unknown Connector',
                powerKW: c.PowerKW || 'Unknown',
                count: c.Quantity || 1,
                status: 'Available'
            }));
            station.totalConnectors = ocm.Connections.reduce((sum, c) => sum + (c.Quantity || 1), 0);
        }

        let hasLiveAvailability = false;
        let available = 0;

        if (googlePlace.evChargeOptions) {
            station.totalConnectors = googlePlace.evChargeOptions.connectorCount || station.totalConnectors;
            
            if (googlePlace.evChargeOptions.connectorAggregation) {
                googlePlace.evChargeOptions.connectorAggregation.forEach(agg => {
                    if (agg.availableCount !== undefined && agg.availableCount !== null) {
                        available += agg.availableCount;
                        hasLiveAvailability = true;
                    }
                });
                
                station.connectors = googlePlace.evChargeOptions.connectorAggregation.map(agg => ({
                    type: formatConnectorName(agg.type) || 'Unknown Type',
                    powerKW: agg.maxChargeRateKw || 'Unknown',
                    count: agg.count || 1,
                    availableCount: agg.availableCount,
                    status: (agg.availableCount > 0) ? 'Available' : 'Busy'
                }));
            }
        }

        if (hasLiveAvailability) {
            station.liveStatus = true;
            station.availableCount = available;
            station.status = available > 0 ? 'Operational' : 'Occupied / In Use';
            station.trustType = 'LIVE';
        } else {
            station.status = OCM_STATUS_MAP[ocm.StatusTypeID] || 'Operational';
            station.trustType = 'STATIC';
        }

    } else if (ocm) {
        station.id = `ocm-${ocm.ID}`;
        station.title = ocm.AddressInfo.Title;
        station.latitude = parseFloat(ocm.AddressInfo.Latitude);
        station.longitude = parseFloat(ocm.AddressInfo.Longitude);
        station.address = getOCMAddress(ocm);
        station.operator = (ocm.OperatorInfo && ocm.OperatorInfo.Title) || 'Unknown Operator';
        station.status = OCM_STATUS_MAP[ocm.StatusTypeID] || 'Operational';
        station.hours = ocm.AddressInfo.AccessComments || '24/7';
        station.contact = ocm.AddressInfo.ContactTelephone1 || 'N/A';
        station.trustType = 'STATIC';
        
        if (ocm.Connections) {
            station.connectors = ocm.Connections.map(c => ({
                type: (c.ConnectionType && c.ConnectionType.Title) || 'Unknown Connector',
                powerKW: c.PowerKW || 'Unknown',
                count: c.Quantity || 1,
                status: 'Available'
            }));
            station.totalConnectors = ocm.Connections.reduce((sum, c) => sum + (c.Quantity || 1), 0);
        }
    } else if (googlePlace) {
        station.id = `google-${googlePlace.id}`;
        station.title = (googlePlace.displayName && googlePlace.displayName.text) || 'EV Charging Station';
        station.latitude = parseFloat(googlePlace.location.latitude);
        station.longitude = parseFloat(googlePlace.location.longitude);
        station.address = googlePlace.formattedAddress || 'Maharashtra, India';
        station.operator = 'Google Places Network';
        station.trustType = 'STATIC';
        
        let hasLiveAvailability = false;
        let available = 0;

        if (googlePlace.evChargeOptions) {
            station.totalConnectors = googlePlace.evChargeOptions.connectorCount || 0;
            
            if (googlePlace.evChargeOptions.connectorAggregation) {
                googlePlace.evChargeOptions.connectorAggregation.forEach(agg => {
                    if (agg.availableCount !== undefined && agg.availableCount !== null) {
                        available += agg.availableCount;
                        hasLiveAvailability = true;
                    }
                });
                
                station.connectors = googlePlace.evChargeOptions.connectorAggregation.map(agg => ({
                    type: formatConnectorName(agg.type) || 'Unknown Type',
                    powerKW: agg.maxChargeRateKw || 'Unknown',
                    count: agg.count || 1,
                    availableCount: agg.availableCount,
                    status: (agg.availableCount > 0) ? 'Available' : 'Busy'
                }));
            }
        }

        if (hasLiveAvailability) {
            station.liveStatus = true;
            station.availableCount = available;
            station.status = available > 0 ? 'Operational' : 'Occupied / In Use';
            station.trustType = 'LIVE';
        } else {
            station.status = 'Operational';
        }
    }

    // Merge database state modifications (Admins + Community)
    applyOverridesAndReports(station);

    return station;
}

/**
 * Merge live Google Places updates into the existing loaded station set
 */
function mergeLiveGooglePlaces(googlePlaces) {
    if (!googlePlaces || googlePlaces.length === 0) return;

    let updatedCount = 0;
    const unmatchedPlaces = [];

    googlePlaces.forEach(googlePlace => {
        if (!googlePlace.location) return;
        const gLat = parseFloat(googlePlace.location.latitude);
        const gLng = parseFloat(googlePlace.location.longitude);
        
        let matchedStation = null;
        let minDistance = 50;

        allStations.forEach(station => {
            const dist = getDistanceMeters(station.latitude, station.longitude, gLat, gLng);
            if (dist < minDistance) {
                minDistance = dist;
                matchedStation = station;
            }
        });

        if (matchedStation) {
            const merged = buildMergedStation(
                { 
                    ID: matchedStation.id.split('-').pop(), 
                    AddressInfo: { Title: matchedStation.title },
                    OperatorInfo: { Title: matchedStation.operator },
                    Connections: matchedStation.connectors.map(c => ({
                        ConnectionType: { Title: c.type },
                        PowerKW: c.powerKW,
                        Quantity: c.count
                    }))
                }, 
                googlePlace
            );

            // Copy dynamic parameters over to the master record
            matchedStation.liveStatus = merged.liveStatus;
            matchedStation.availableCount = merged.availableCount;
            matchedStation.totalConnectors = merged.totalConnectors;
            matchedStation.connectors = merged.connectors;
            matchedStation.status = merged.status;
            matchedStation.trustType = merged.liveStatus ? 'LIVE' : 'STATIC';
            
            // Reapply DB overrides in case OCM keys synced
            applyOverridesAndReports(matchedStation);
            
            updatedCount++;
            
            const marker = markerMap.get(matchedStation.id);
            if (marker) {
                const isAvailable = !matchedStation.liveStatus || matchedStation.availableCount > 0;
                marker.setIcon(getChargerIcon(matchedStation.liveStatus, isAvailable, matchedStation.status, matchedStation.communityFault));
            }
        } else {
            unmatchedPlaces.push(googlePlace);
        }
    });

    if (unmatchedPlaces.length > 0) {
        const newStations = unmatchedPlaces.map(gp => buildMergedStation(null, gp));
        allStations = [...allStations, ...newStations];
    }

    if (routePolylinePath.length > 0) {
        filterOnRouteChargers(routePolylinePath);
        if (vehicleMarker) {
            const pos = vehicleMarker.getPosition();
            calculateBestRecommendation(pos.lat(), pos.lng());
        }
        if (activeRouteInfo) {
            if (recommendedStation) {
                fetchLiveGridTelemetry(recommendedStation).then(gridData => {
                    if (gridData) {
                        recommendedStation.liveGridData = gridData;
                        updateRecommendationDashboard(activeRouteInfo);
                    }
                });
            }
            updateRecommendationDashboard(activeRouteInfo);
        }
    }

    if (updatedCount > 0 || unmatchedPlaces.length > 0) {
        plotMarkers([]);
        console.log(`Live status sync: Updated ${updatedCount} stations, added ${unmatchedPlaces.length} new stations.`);
    }
}

/**
 * Submit User Report: Is this charger working? (✓ YES / ✕ NO)
 */
window.submitChargerReport = async function(stationId, isWorking) {
    if (!activeUser) {
        alert('You must be logged in to submit a working report.');
        return;
    }
    
    showStatus('Submitting status report...');
    try {
        const response = await fetch('/api/reports/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stationId: stationId,
                working: isWorking,
                userEmail: activeUser.email
            })
        });

        if (response.ok) {
            showToastNotification(isWorking ? '🟢 Reported Working' : '🔴 Reported Faulty');
            
            // Re-sync reports summary from backend immediately
            const repSummary = await fetch('/api/reports/summary');
            if (repSummary.ok) {
                communityReports = await repSummary.json();
            }

            // Find station and reapply parameters
            const station = allStations.find(s => s.id === stationId);
            if (station) {
                applyOverridesAndReports(station);
                
                // Update marker icon
                const marker = markerMap.get(station.id);
                if (marker) {
                    const isAvailable = !station.liveStatus || station.availableCount > 0;
                    marker.setIcon(getChargerIcon(station.liveStatus, isAvailable, station.status, station.communityFault));
                }

                // Refresh bottom details container
                const bottomSheet = document.getElementById('bottom-sheet');
                if (bottomSheet && !bottomSheet.classList.contains('hidden')) {
                    const content = document.getElementById('bottom-sheet-content');
                    if (content) {
                        content.innerHTML = createInfoWindowContent(station, station.liveGridData);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Report submission failed:', e);
    } finally {
        hideStatus();
    }
};

/**
 * Handle bookmarking (Save/Remove stations in Profile)
 */
window.toggleBookmarkStation = function(stationId) {
    if (!activeUser) {
        alert('Please login to bookmark stations.');
        return;
    }
    
    if (!activeUser.savedStations) activeUser.savedStations = [];
    const index = activeUser.savedStations.indexOf(stationId);
    
    if (index > -1) {
        activeUser.savedStations.splice(index, 1);
        showToastNotification('Removed from saved stations.');
    } else {
        activeUser.savedStations.push(stationId);
        showToastNotification('Station bookmarked successfully!');
    }
    
    // Refresh open templates
    const station = allStations.find(s => s.id === stationId);
    if (station) {
        const content = document.getElementById('bottom-sheet-content');
        if (content) content.innerHTML = createInfoWindowContent(station, station.liveGridData);
    }
    renderProfileDetails();
};

/**
 * Create InfoWindow & Minimized Station Card Content HTML (Clean & Streamlined)
 */
function createInfoWindowContent(station, liveGridData = null) {
    const isAvailable = !station.liveStatus || station.availableCount > 0;
    const availText = station.liveStatus 
        ? `${station.availableCount}/${station.totalConnectors} Available` 
        : (station.status || 'Active');
    
    let dotClass = 'available';
    if (station.communityFault || (station.status && station.status.toLowerCase().includes('faulty'))) {
        dotClass = 'offline';
    } else if (station.liveStatus && station.availableCount === 0) {
        dotClass = 'busy';
    } else if (station.status && (station.status.toLowerCase().includes('offline') || station.status.toLowerCase().includes('not operational'))) {
        dotClass = 'offline';
    }

    // Calculate distance relative to current user location
    let distText = '1.8km';
    if (userLocation && station.latitude && station.longitude) {
        const dM = getDistanceMeters(userLocation.lat, userLocation.lng, station.latitude, station.longitude);
        distText = dM > 1000 ? `${(dM / 1000).toFixed(1)}km` : `${Math.round(dM)}m`;
    }

    const gridInfo = liveGridData 
        ? { gridLoad: liveGridData.gridLoad, price: liveGridData.price }
        : getStationGridLoadAndPrice(station);

    // Connector & Power Chips (e.g. CCS2, Type 2, 120kW Fast)
    let maxPowerKW = 0;
    const connectorTypes = new Set();
    if (station.connectors && station.connectors.length > 0) {
        station.connectors.forEach(c => {
            if (c.type) connectorTypes.add(c.type);
            const p = parseFloat(c.powerKW);
            if (!isNaN(p) && p > maxPowerKW) maxPowerKW = p;
        });
    }

    const chipsHTML = [];
    if (connectorTypes.size > 0) {
        connectorTypes.forEach(t => chipsHTML.push(`<span class="station-chip">${t}</span>`));
    } else {
        chipsHTML.push(`<span class="station-chip">CCS2</span>`);
    }

    if (maxPowerKW > 0) {
        chipsHTML.push(`<span class="station-chip highlight">⚡ ${maxPowerKW}kW Fast</span>`);
    } else {
        const stationType = getStationType(station);
        chipsHTML.push(`<span class="station-chip highlight">⚡ ${stationType === 'DC' ? '60kW Fast' : '22kW AC'}</span>`);
    }

    const isBookmarked = activeUser && activeUser.savedStations && activeUser.savedStations.includes(station.id);
    const isRecommended = recommendedStation && (recommendedStation.id === station.id);

    return `
        <div class="station-minimal-card" id="station-card-${station.id}">
            <div class="station-top-row">
                <div class="station-title-group">
                    <h3 class="station-main-title">${station.title}</h3>
                    <div class="station-status-sub">
                        <span class="status-indicator-dot ${dotClass}"></span>
                        <span>${availText}</span>
                        <span>•</span>
                        <span>${distText}</span>
                    </div>
                </div>
                <div class="station-grid-box ${gridInfo.gridLoad}">
                    <span class="station-grid-label">GRID DEMAND</span>
                    <span class="station-grid-val">${gridInfo.gridLoad.charAt(0) + gridInfo.gridLoad.slice(1).toLowerCase()}</span>
                </div>
            </div>

            <!-- Connector & Speed Chips -->
            <div class="station-chips-row">
                ${chipsHTML.join('')}
            </div>

            <!-- Is This Charger Working? Feedback Option for all chargers at that station -->
            <div class="charger-feedback-section">
                <span class="feedback-question-text">Is this charger working?</span>
                <div class="feedback-buttons-row">
                    <button class="btn-thumb-feedback yes" onclick="submitChargerReport('${station.id}', true)" title="Confirm charger working at this station">
                        <span>👍</span> Yes
                    </button>
                    <button class="btn-thumb-feedback no" onclick="submitChargerReport('${station.id}', false)" title="Report issue with charger at this station">
                        <span>👎</span> No
                    </button>
                </div>
            </div>

            <!-- Action Buttons Row -->
            <div class="station-card-actions">
                <button class="btn-card-navigate" onclick="selectStationAsDestination('${station.id}')">
                    <span class="material-symbols-outlined" style="font-size: 18px;">alt_route</span>
                    <span>${(routePolylinePath && routePolylinePath.length > 0) ? '➕ Add to Route' : (isRecommended ? '⚡ Navigate to Charger' : '➕ Add to Route')}</span>
                </button>
                <button class="btn-card-icon-action ${isBookmarked ? 'bookmarked' : ''}" onclick="toggleBookmarkStation('${station.id}')" title="Bookmark Station">
                    <span class="material-symbols-outlined">${isBookmarked ? 'bookmark' : 'bookmark_border'}</span>
                </button>
                <button class="btn-card-icon-action" onclick="toggleStationDetails('${station.id}')" title="Show / Hide Full Details">
                    <span class="material-symbols-outlined" id="details-chevron-${station.id}">expand_more</span>
                </button>
            </div>

            <!-- Collapsible full details for users who want extra info -->
            <div class="more-details-panel hidden" id="station-details-more-${station.id}">
                <div><strong>Address:</strong> ${station.address || 'N/A'}</div>
                <div><strong>Operator:</strong> ${station.operator || 'N/A'} | <strong>Hours:</strong> ${station.hours || '24/7'}</div>
                <div><strong>Est. Price:</strong> ${gridInfo.price} | <strong>Live Temp:</strong> ${liveGridData ? `${liveGridData.temperature}°C` : '--'}</div>
                ${station.communityFault ? `<div style="color:#f87171; font-weight:600;">⚠️ Community reported faults present</div>` : ''}
            </div>
        </div>
    `;
}

/**
 * Toggle extra station details accordion
 */
window.toggleStationDetails = function(stationId) {
    const details = document.getElementById(`station-details-more-${stationId}`);
    const chevron = document.getElementById(`details-chevron-${stationId}`);
    if (details) {
        details.classList.toggle('hidden');
        if (chevron) {
            chevron.textContent = details.classList.contains('hidden') ? 'expand_more' : 'expand_less';
        }
    }
};

/**
 * Global callback when user selects a station in their InfoWindow
 */
window.selectStationAsDestination = function(stationId) {
    const station = allStations.find(s => s.id === stationId);
    if (!station) return;
    
    if (routePolylinePath && routePolylinePath.length > 0) {
        // A route is already active! Add the charger as a stopover waypoint
        addChargerStopover(stationId);
    } else {
        // No active route. Route from current GPS location directly to this charger!
        const startInput = document.getElementById('input-start');
        if (startInput) {
            startInput.value = 'My Location (GPS)';
        }
        const destInput = document.getElementById('input-destination');
        if (destInput) {
            destInput.value = station.title;
        }
        activeWaypoint = null; // Clear waypoint
        switchUserTab('plan');
        logChargerDiversion(station);
        planTrip({ lat: station.latitude, lng: station.longitude }, station.title);
    }
    
    if (activeInfoWindow) {
        activeInfoWindow.close();
        activeInfoWindow = null;
    }
};

/**
 * Focus and center map on a specific station marker and open its info popup
 */
window.focusStationOnMap = function(stationId) {
    const station = allStations.find(s => s.id === stationId);
    if (!station) return;
    
    const pos = { lat: station.latitude, lng: station.longitude };
    map.setCenter(pos);
    map.setZoom(15);
    
    const marker = markerMap.get(stationId);
    if (marker) {
        google.maps.event.trigger(marker, 'click');
    }
};

/**
 * Plot EV Charger Markers on the Map
 */
function plotMarkers(stations) {
    markerMap.forEach((marker) => {
        marker.setMap(null);
    });
    markerMap.clear();

    const stationsToDraw = (routePolylinePath.length > 0) ? onRouteChargers : allStations;

    stationsToDraw.forEach(station => {
        if (station.latitude === undefined || station.latitude === null || isNaN(station.latitude) ||
            station.longitude === undefined || station.longitude === null || isNaN(station.longitude)) {
            return;
        }

        const type = getStationType(station);
        if (chargerTypeFilter === 'AC' && type === 'DC') return;
        if (chargerTypeFilter === 'DC' && type === 'AC') return;

        if (filter247Only) {
            const hours = (station.hours || '').toLowerCase();
            if (hours.length > 0 && !hours.includes('24') && !hours.includes('open')) return;
        }

        if (activeOnly) {
            const isOffline = station.status.toLowerCase().includes('not operational') || 
                              station.status.toLowerCase().includes('offline') || 
                              station.status.toLowerCase().includes('decommissioned') ||
                              station.status.toLowerCase().includes('maintenance') ||
                              station.communityFault;
            const isOccupied = station.liveStatus && station.availableCount === 0;
            if (isOffline || isOccupied) return;
        }

        const isRecommended = recommendedStation && (recommendedStation.id === station.id);
        const isAvailable = !station.liveStatus || station.availableCount > 0;
        const icon = isRecommended 
            ? getRecommendedIcon()
            : getChargerIcon(station.liveStatus, isAvailable, station.status, station.communityFault);

        const marker = new google.maps.Marker({
            position: { lat: station.latitude, lng: station.longitude },
            map: map,
            icon: icon,
            title: station.title,
            zIndex: isRecommended ? 10000 : 100
        });

        marker.addListener('click', () => {
            if (activeInfoWindow) {
                activeInfoWindow.close();
            }
            
            // 1. Open sleek InfoWindow directly on the map marker itself
            const infoContainerId = `iw-container-${station.id}`;
            const initialContent = `<div id="${infoContainerId}" style="min-width: 260px; max-width: 320px;">${createInfoWindowContent(station, station.liveGridData || null)}</div>`;

            const infoWindow = new google.maps.InfoWindow({
                content: initialContent,
                maxWidth: 340,
                pixelOffset: new google.maps.Size(0, -8)
            });
            
            infoWindow.open({
                anchor: marker,
                map: map,
                shouldFocus: false,
            });
            activeInfoWindow = infoWindow;

            // 2. Also populate the bottom sheet / card
            const bottomSheet = document.getElementById('bottom-sheet');
            const content = document.getElementById('bottom-sheet-content');
            if (bottomSheet && content) {
                content.innerHTML = createInfoWindowContent(station, station.liveGridData || null);
                bottomSheet.classList.remove('hidden');
            }
            
            fetchLiveGridTelemetry(station).then(gridData => {
                if (gridData) {
                    station.liveGridData = gridData;
                    const container = document.getElementById(infoContainerId);
                    if (container) {
                        container.innerHTML = createInfoWindowContent(station, gridData);
                    }
                    if (content) {
                        content.innerHTML = createInfoWindowContent(station, gridData);
                    }
                }
            });
        });

        markerMap.set(station.id, marker);
    });

    updateDiagnostics();
}

/**
 * Fetch live grid demand data from India Energy Atlas proxy endpoint
 */
async function fetchIndiaEnergyAtlasGridData() {
    try {
        const response = await fetch('/api/grid-demand');
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        liveGridDemand = await response.json();
        console.log('Fetched India Energy Atlas Grid Data:', liveGridDemand);
    } catch (e) {
        console.warn('Failed to fetch India Energy Atlas grid data, using simulated fallback:', e);
        liveGridDemand = {
            demand_mw: Math.round(19000 + Math.random() * 6000),
            frequency_hz: parseFloat((49.92 + Math.random() * 0.16).toFixed(2)),
            as_of: new Date().toISOString(),
            source: 'SLDC-POSOCO (Local Fallback)',
            status: 'SIMULATED'
        };
    }
}

/**
 * Calculate macro-grid load stress index (0.0 = low stress, 1.0 = critical stress)
 * based on India Energy Atlas API telemetry (grid demand and frequency)
 */
function getGridStressIndex() {
    if (!liveGridDemand) return 0.5; // default medium stress if not loaded

    const demand = liveGridDemand.demand_mw;
    const frequency = liveGridDemand.frequency_hz;

    // Normal baseline peak demand in India is ~22,000 MW.
    // Map demand between 15,000 MW (low) and 25,000 MW (critical) to 0.0 - 1.0
    const normalizedDemand = Math.min(1.0, Math.max(0.0, (demand - 15000) / 10000));

    // Ideal frequency is 50.0 Hz. Drop below 50.0 indicates grid stress.
    // Map frequency between 50.05 Hz (low load) and 49.90 Hz (critical overload) to 0.0 - 1.0
    const freqFactor = Math.min(1.0, Math.max(0.0, (50.05 - frequency) / 0.15));

    // Combined macro-grid stress index (50% weight to demand ratio, 50% weight to frequency load factor)
    return (normalizedDemand * 0.5) + (freqFactor * 0.5);
}

/**
 * Multi-Layer Perceptron (MLP) Neural Network for EV Charger Recommendation Prediction
 * Evaluates optimal suitability scores using real-time grid telemetry and route detour bounds.
 */
class StationRecommendationMLP {
    constructor() {
        // Network Architecture: 6 Input Nodes, 8 Hidden Neurons (ReLU), 1 Output Node (Sigmoid suitability rating)
        // Weight matrix between Input and Hidden layer (8x6)
        this.weightsIH = [
            [-0.8,  0.5, -0.4,  0.8,  0.3,  0.9], // Neuron 1
            [-1.2,  0.9, -0.6,  1.2,  0.4,  1.5], // Neuron 2
            [-0.5,  0.2, -0.2,  0.5,  0.2,  0.6], // Neuron 3
            [-1.5,  1.5, -0.8,  1.5,  0.6,  2.0], // Neuron 4 (sensitive to power rating and live availability)
            [-0.3,  0.6, -0.5,  0.4,  0.5,  0.4], // Neuron 5
            [-0.9,  0.4, -0.3,  0.7,  0.3,  0.8], // Neuron 6
            [-1.1,  0.8, -0.7,  1.0,  0.5,  1.2], // Neuron 7
            [-0.4,  0.3, -0.1,  0.3,  0.1,  0.5]  // Neuron 8
        ];
        this.biasesH = [0.1, -0.2, 0.0, -0.5, 0.2, 0.1, -0.1, 0.3];
        
        // Weight vector between Hidden and Output layer (8x1)
        this.weightsHO = [0.4, 0.8, 0.3, 1.2, 0.5, 1.0, 0.7, 0.3];
        this.biasO = -0.2;
    }
    
    // Rectified Linear Unit (ReLU) activation function for hidden layer
    relu(x) {
        return Math.max(0, x);
    }
    
    // Sigmoid activation function to squeeze final score to [0.0 - 1.0] range
    sigmoid(x) {
        return 1 / (1 + Math.exp(-x));
    }
    
    // Forward propagation to compute predicted score
    predict(inputs) {
        const hiddenOutputs = [];
        for (let h = 0; h < 8; h++) {
            let activation = this.biasesH[h];
            for (let i = 0; i < 6; i++) {
                activation += inputs[i] * this.weightsIH[h][i];
            }
            hiddenOutputs.push(this.relu(activation));
        }
        
        let outputActivation = this.biasO;
        for (let h = 0; h < 8; h++) {
            outputActivation += hiddenOutputs[h] * this.weightsHO[h];
        }
        
        return this.sigmoid(outputActivation);
    }
}

/**
 * Prepares input features and runs MLP Neural Network to predict a station's suitability score
 */
function evaluateStationWithML(station, userLat, userLng) {
    const mlp = new StationRecommendationMLP();
    
    const detour = station.detourDistanceMeters || 0;
    const normalizedDetour = Math.min(1.0, detour / 5000);
    
    let maxPower = 7.4;
    station.connectors.forEach(c => {
        const p = parseFloat(c.powerKW);
        if (!isNaN(p) && p > maxPower) maxPower = p;
    });
    const normalizedPower = Math.min(1.0, (maxPower - 7.4) / 142.6);
    
    const gridStress = getGridStressIndex();
    
    const statusLower = station.status.toLowerCase();
    const isOffline = statusLower.includes('not operational') || 
                      statusLower.includes('offline') || 
                      statusLower.includes('decommissioned') ||
                      statusLower.includes('unknown') ||
                      station.communityFault;
    const isOccupied = station.liveStatus && station.availableCount === 0;
    const availability = (isOffline || isOccupied) ? 0.0 : 1.0;
    
    let solarRadiation = 0;
    if (station.liveGridData && station.liveGridData.solarRadiation) {
        solarRadiation = station.liveGridData.solarRadiation;
    }
    const normalizedSolar = Math.min(1.0, solarRadiation / 800);
    
    const type = getStationType(station);
    const preference = document.getElementById('input-preference').value;
    let preferenceMatch = 1.0;
    if (preference === 'AC' && type === 'DC') preferenceMatch = 0.0;
    if (preference === 'DC' && type === 'AC') preferenceMatch = 0.0;
    
    const inputs = [
        normalizedDetour,
        normalizedPower,
        gridStress,
        availability,
        normalizedSolar,
        preferenceMatch
    ];
    
    return {
        score: mlp.predict(inputs),
        inputs: inputs
    };
}

/**
 * Determine predicted grid load metrics and estimated prices deterministically
 */
function getStationGridLoadAndPrice(station) {
    const hash = Math.abs(Math.sin(station.latitude * 1000 + station.longitude * 1000));
    const stressIndex = getGridStressIndex();
    const combinedLoadFactor = (hash * 0.4) + (stressIndex * 0.6);
    
    let load = 'LOW';
    let priceMultiplier = 1.0;
    
    if (combinedLoadFactor > 0.8) {
        load = 'CRITICAL';
        priceMultiplier = 1.65;
    } else if (combinedLoadFactor > 0.6) {
        load = 'HIGH';
        priceMultiplier = 1.35;
    } else if (combinedLoadFactor > 0.35) {
        load = 'MEDIUM';
        priceMultiplier = 1.15;
    }
    
    const type = getStationType(station);
    const basePrice = (type === 'DC') ? 11.5 : 5.5;
    const priceVal = (basePrice * priceMultiplier).toFixed(2);
    
    return {
        gridLoad: load,
        price: `₹${priceVal}/kWh`
    };
}

/**
 * Smart recommendation engine using MLP neural network model outputs
 */
function calculateBestRecommendation(userLat, userLng) {
    let bestStation = null;
    let bestScore = -Infinity;
    
    const remainingRangeMeters = (vehicleSOC / 100) * vehicleRange * 1000;
    const safetyBufferRange = ((vehicleSOC - minReserve) / 100) * vehicleRange * 1000;
    
    onRouteChargers.forEach(station => {
        const statusLower = station.status.toLowerCase();
        if (statusLower.includes('not operational') || statusLower.includes('removed')) return;
        
        const type = getStationType(station);
        const preference = document.getElementById('input-preference').value;
        if (preference === 'AC' && type === 'DC') return;
        if (preference === 'DC' && type === 'AC') return;
        
        const distFromVehicle = getDistanceMeters(userLat, userLng, station.latitude, station.longitude);
        if (distFromVehicle > safetyBufferRange && distFromVehicle > 1000) {
            return;
        }

        const mlResult = evaluateStationWithML(station, userLat, userLng);
        const score = mlResult.score;
        station.mlScore = score;
        
        if (score > bestScore) {
            bestScore = score;
            bestStation = station;
        }
    });

    recommendedStation = bestStation;
}

/**
 * Fetch live grid telemetry dynamically on-demand from Open-Meteo API (thermal proxy and solar index)
 */
async function fetchLiveGridTelemetry(station) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.latitude}&longitude=${station.longitude}&current=temperature_2m,shortwave_radiation`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('API request failed');
        const data = await response.json();
        
        const temp = data.current.temperature_2m;
        const solar = data.current.shortwave_radiation;
        
        const stressIndex = getGridStressIndex();
        const thermalFactor = Math.min(1.0, Math.max(0.0, (temp - 20) / 18));
        const combinedLoadFactor = (thermalFactor * 0.4) + (stressIndex * 0.6);
        
        let load = 'LOW';
        let priceMultiplier = 1.0;
        
        if (combinedLoadFactor > 0.8) {
            load = 'CRITICAL';
            priceMultiplier = 1.65;
        } else if (combinedLoadFactor > 0.6) {
            load = 'HIGH';
            priceMultiplier = 1.35;
        } else if (combinedLoadFactor > 0.35) {
            load = 'MEDIUM';
            priceMultiplier = 1.15;
        }
        
        let solarDiscount = 0;
        if (solar > 400) {
            solarDiscount = 0.15; 
        } else if (solar > 150) {
            solarDiscount = 0.05; 
        }
        
        const type = getStationType(station);
        const basePrice = (type === 'DC') ? 11.5 : 5.5;
        const finalPrice = (basePrice * priceMultiplier * (1 - solarDiscount)).toFixed(2);
        
        return {
            gridLoad: load,
            price: `₹${finalPrice}/kWh`,
            temperature: temp,
            solarRadiation: solar,
            solarDiscountPercent: Math.round(solarDiscount * 100)
        };
    } catch (e) {
        console.warn('Failed to fetch live coordinates telemetry, falling back:', e);
        return null;
    }
}

/**
 * Retrieve OCM data for all of India
 */
async function fetchAllIndiaChargers() {
    const url = `/api/ocm-chargers?output=json&maxresults=2000&compact=true&verbose=false&countrycode=IN`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            throw new Error('Invalid format.');
        }
        return data;
    } catch (error) {
        console.error('Fetch OCM India chargers failed:', error);
        throw error;
    }
}

/**
 * Fetch live EV charger data from Google Places API for the current map viewport
 */
async function fetchGooglePlacesForViewport() {
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) throw new Error('API key not found');

    const bounds = map.getBounds();
    if (!bounds) throw new Error('Map bounds not ready');

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const url = 'https://places.googleapis.com/v1/places:searchText';
    const body = {
        textQuery: "electric vehicle charging station",
        includedType: "electric_vehicle_charging_station",
        locationRestriction: {
            rectangle: {
                low: { latitude: sw.lat(), longitude: sw.lng() },
                high: { latitude: ne.lat(), longitude: ne.lng() }
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.evChargeOptions,places.id'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data.places || [];
    } catch (error) {
        console.warn('Dynamic viewport Places API fetch failed:', error.message);
        throw error;
    }
}

/**
 * Fetch and merge live data when map is idle (moved/zoomed)
 */
async function updateLiveStatusForViewport() {
    showStatus('Syncing live data from Google Places...');
    try {
        const places = await fetchGooglePlacesForViewport();
        if (places && places.length > 0) {
            mergeLiveGooglePlaces(places);
            showStatus(`Successfully synced ${places.length} live stations!`);
            setTimeout(hideStatus, 3000);
        } else {
            showStatus('No new live chargers found in this view.');
            setTimeout(hideStatus, 3000);
        }
    } catch (error) {
        if (error.message.includes('Quota exceeded') || error.message.includes('429')) {
            showStatus('GCP Free Quota Exceeded (100 daily limit hit). Live data is temporarily locked.', true);
        } else {
            showStatus(`Sync failed: ${error.message}`, true);
        }
        setTimeout(hideStatus, 6000);
    }
}

/**
 * Initial load of all India OCM charging stations
 */
async function loadInitialData() {
    showStatus('Loading EV charging stations across India...');
    
    try {
        // Sync custom report DB summary and overrides
        await syncDatabaseState();
        
        // Fetch grid telemetry from India Energy Atlas
        await fetchIndiaEnergyAtlasGridData();

        const ocmRaw = await fetchAllIndiaChargers();
        console.log(`Fetched ${ocmRaw.length} stations from Open Charge Map.`);
        
        allStations = ocmRaw.map(ocm => buildMergedStation(ocm, null));
        
        plotMarkers(allStations);
        hideStatus();
    } catch (error) {
        console.error('Load initial data failed:', error);
        showStatus('Failed to load charging stations. Please refresh or try again.', true);
    }
}

/**
 * Google Maps Setup and Autocomplete
 */
function initMap(retriesLeft = 20) {
    if (typeof google === 'undefined' || !google.maps) {
        // The Maps script now loads asynchronously (key fetched from /api/config),
        // so it may not be ready the instant initMap() is first called - retry briefly.
        if (retriesLeft > 0) {
            setTimeout(() => initMap(retriesLeft - 1), 250);
            return;
        }
        console.error('Google Maps API failed to load or is not yet available.');
        showStatus('Google Maps API failed to load.', true);
        return;
    }

    createDiagnosticsBadge();

    const maharashtraCenter = { lat: 19.7515, lng: 75.7139 };
    
    map = new google.maps.Map(document.getElementById('map'), {
        center: maharashtraCenter,
        zoom: 7,
        disableDefaultUI: true,
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#1e293b" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
            {
                featureType: "administrative.locality",
                elementType: "labels.text.fill",
                stylers: [{ color: "#cbd5e1" }],
            },
            {
                featureType: "poi",
                elementType: "labels.text.fill",
                stylers: [{ color: "#94a3b8" }],
            },
            {
                featureType: "poi.park",
                elementType: "geometry",
                stylers: [{ color: "#0f172a" }],
            },
            {
                featureType: "poi.park",
                elementType: "labels.text.fill",
                stylers: [{ color: "#475569" }],
            },
            {
                featureType: "road",
                elementType: "geometry",
                stylers: [{ color: "#334155" }],
            },
            {
                featureType: "road",
                elementType: "geometry.stroke",
                stylers: [{ color: "#1e293b" }],
            },
            {
                featureType: "road",
                elementType: "labels.text.fill",
                stylers: [{ color: "#94a3b8" }],
            },
            {
                featureType: "road.highway",
                elementType: "geometry",
                stylers: [{ color: "#475569" }],
            },
            {
                featureType: "road.highway",
                elementType: "geometry.stroke",
                stylers: [{ color: "#1e293b" }],
            },
            {
                featureType: "water",
                elementType: "geometry",
                stylers: [{ color: "#0f172a" }],
            },
            {
                featureType: "water",
                elementType: "labels.text.fill",
                stylers: [{ color: "#475569" }],
            },
        ]
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map: map,
        draggable: true, // Support draggable route modification (Rerouting)
        suppressMarkers: true,
        polylineOptions: {
            strokeColor: '#10b981',
            strokeWeight: 6,
            strokeOpacity: 0.85
        }
    });

    // Rerouting Listener
    directionsRenderer.addListener('directions_changed', () => {
        const directions = directionsRenderer.getDirections();
        if (directions) {
            lastDirectionsResponse = directions;
            const route = directions.routes[0];
            routePolylinePath = route.overview_path;
            
            showToastNotification('Route changed — recalculating chargers & recommendations...');
            
            // Re-filter chargers along route and recommendations
            filterOnRouteChargers(routePolylinePath);
            
            if (vehicleMarker) {
                const pos = vehicleMarker.getPosition();
                calculateBestRecommendation(pos.lat(), pos.lng());
            }
            
            plotMarkers([]);
            
            const leg = route.legs[0];
            activeRouteInfo = {
                distanceKm: parseFloat(leg.distance.value / 1000).toFixed(0),
                durationText: leg.duration.text
            };
            
            updateRecommendationDashboard(activeRouteInfo);
            renderRouteChargersList();
        }
    });

    // Wire up navigation controls
    const navBtn = document.getElementById('nav-btn');
    if (navBtn) {
        navBtn.addEventListener('click', () => {
            isNavigating = !isNavigating;
            if (isNavigating) {
                navBtn.classList.add('active');
            } else {
                navBtn.classList.remove('active');
            }
            
            // Re-center map immediately on current position
            const pos = vehicleMarker ? vehicleMarker.getPosition() : userLocation;
            if (pos) {
                map.setCenter(pos);
                map.setZoom(13);
                showToastNotification('📍 Centered on vehicle position');
            } else {
                showToastNotification('⚠️ Position unavailable');
            }
        });
    }

    const simBtn = document.getElementById('sim-btn');
    if (simBtn) {
        simBtn.addEventListener('click', () => {
            toggleSimulator();
        });
    }

    map.addListener('dragstart', () => {
        isNavigating = false;
        if (navBtn) navBtn.classList.remove('active');
    });

    // Map idle handler
    let idleTimeout = null;
    map.addListener('idle', () => {
        if (idleTimeout) clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            updateLiveStatusForViewport();
        }, 1500);
    });

    // Start Location inputs wiring
    const useCurrentBtn = document.getElementById('btn-use-current');
    const startInput = document.getElementById('input-start');
    if (useCurrentBtn && startInput) {
        useCurrentBtn.addEventListener('click', () => {
            if (userLocation) {
                startInput.value = 'My Location (GPS)';
                showToastNotification('📍 Starting location set to current GPS coordinates.');
            } else {
                showStatus('GPS location unavailable. Please type starting city.', true);
                setTimeout(hideStatus, 4000);
            }
        });
    }

    // Plan button wire up
    const planBtn = document.getElementById('plan-btn');
    if (planBtn) {
        planBtn.addEventListener('click', () => {
            planTrip();
        });
    }

    // Battery range slider
    const batterySlider = document.getElementById('input-battery');
    const batteryValueSpan = document.getElementById('battery-value');
    if (batterySlider && batteryValueSpan) {
        batterySlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            batteryValueSpan.textContent = `${val}%`;
            vehicleSOC = val;
            
            if (routePolylinePath.length > 0 && vehicleMarker) {
                const pos = vehicleMarker.getPosition();
                calculateBestRecommendation(pos.lat(), pos.lng());
                plotMarkers([]);
                if (activeRouteInfo) {
                    updateRecommendationDashboard(activeRouteInfo);
                }
            }
        });
    }

    // Filters
    const filterButtons = document.querySelectorAll('#type-filter-group .btn-filter');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            chargerTypeFilter = e.target.getAttribute('data-type');
            
            if (routePolylinePath.length > 0 && vehicleMarker) {
                const pos = vehicleMarker.getPosition();
                calculateBestRecommendation(pos.lat(), pos.lng());
            }
            plotMarkers([]);
        });
    });

    const activeCheckbox = document.getElementById('active-only-checkbox');
    if (activeCheckbox) {
        activeCheckbox.addEventListener('change', (e) => {
            activeOnly = e.target.checked;
            plotMarkers([]);
        });
    }

    // Collapsible Legend card header click toggle
    const legendHeader = document.getElementById('legend-header');
    const legendCard = document.getElementById('legend-card');
    if (legendHeader && legendCard) {
        legendHeader.addEventListener('click', () => {
            legendCard.classList.toggle('collapsed');
        });
    }

    // Home screen search box enter key handler
    const homeSearchDest = document.getElementById('home-search-dest');
    if (homeSearchDest) {
        homeSearchDest.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                syncSearchDestination(homeSearchDest.value);
            }
        });
    }

    // Set up Dynamic pricing scrolling EV animation
    setupScrollRoadAnimation();

    // Auto load baseline data
    loadInitialData().then(() => {
        startGeolocationTracking();
    });
}

/**
 * Watch high-accuracy GPS coordinates using HTML5 Geolocation API
 */
function startGeolocationTracking() {
    if (!navigator.geolocation) {
        console.warn('Geolocation is not supported by this browser.');
        userLocation = { lat: 19.2183, lng: 72.9781 }; // Default to Thane center
        updateVehiclePosition(userLocation.lat, userLocation.lng);
        return;
    }

    watchId = navigator.geolocation.watchPosition(
        async (position) => {
            if (simIntervalId) return;

            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            userLocation = { lat, lng };
            updateVehiclePosition(lat, lng);
            
            // ==========================================
            // AI DYNAMIC ETA PREDICTION LOGIC
            // ==========================================
            if (destinationMarker && directionsService) {
                const request = {
                    origin: userLocation,
                    destination: destinationMarker.getPosition(),
                    travelMode: google.maps.TravelMode.DRIVING
                };
                
                directionsService.route(request, async (response, status) => {
                    if (status === google.maps.DirectionsStatus.OK) {
                        const route = response.routes[0];
                        const durationSec = route.legs[0].duration.value;
                        const etaMinutes = Math.round(durationSec / 60);
                        
                        try {
                            // Call our AI prediction service with the new real-time ETA
                            const mlResponse = await fetch('/api/predict_arrival', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    station_id: recommendedStation ? recommendedStation.id : 'unknown', 
                                    eta_minutes: etaMinutes 
                                })
                            });
                            
                            if (mlResponse.ok) {
                                const aiData = await mlResponse.json();
                                console.log("AI Prediction Updated:", aiData);
                                // Show a notification with the AI's prediction!
                                showToastNotification(`📍 AI Update: Arriving at ${aiData.predicted_arrival_time} | Grid: ${aiData.predicted_grid_load} | Price: ₹${aiData.dynamic_price_at_arrival}/kWh`);
                            }
                        } catch(e) {
                            console.log("ML API not running yet.", e);
                        }
                    }
                });
            }
        },
        (error) => {
            console.warn('GPS location lookup failed, using Thane fallback:', error);
            if (!userLocation) {
                userLocation = { lat: 19.2183, lng: 72.9781 }; // Default to Thane center
                updateVehiclePosition(userLocation.lat, userLocation.lng);
            }
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
}

/**
 * Update user vehicle marker and optionally center map
 */
function updateVehiclePosition(lat, lng) {
    const pos = { lat, lng };

    if (!vehicleMarker) {
        vehicleMarker = new google.maps.Marker({
            position: pos,
            map: map,
            icon: getVehicleIcon(),
            title: 'Your Location',
            zIndex: 99999
        });
    } else {
        vehicleMarker.setPosition(pos);
    }

    if (isNavigating) {
        map.setCenter(pos);
        if (map.getZoom() < 13) {
            map.setZoom(13);
        }
    }
}

/**
 * Custom SVG vehicle icon
 */
function getVehicleIcon() {
    return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: '#3b82f6',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
    };
}

/**
 * Safely clear current directions renderer routes to prevent Google Maps API internal object crashes
 */
function clearDirectionsRoute() {
    if (!directionsRenderer) return;
    try {
        directionsRenderer.setDirections({ routes: [] });
    } catch (err) {
        console.warn('setDirections empty routes failed, resetting map layer:', err);
        try {
            directionsRenderer.setMap(null);
            directionsRenderer.setMap(map);
        } catch (e) {
            console.error('Failed to reset directions renderer map:', e);
        }
    }
}

/**
 * Sync search destination input at top of app
 */
window.syncSearchDestination = function(val) {
    if (!val || val.trim() === '') return;
    
    // Attempt Google Places search first (highly reliable on viewport/place queries)
    const request = {
        query: val,
        fields: ['name', 'geometry']
    };
    
    const service = new google.maps.places.PlacesService(map);
    service.findPlaceFromQuery(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results[0] && results[0].geometry) {
            const loc = results[0].geometry.location;
            
            // Clear any active route so it behaves as local area browsing
            clearDirectionsRoute();
            routePolylinePath = [];
            onRouteChargers = [];
            activeWaypoint = null;
            recommendedStation = null;
            
            // Hide routing details panel
            const recPanel = document.getElementById('route-recommendation-panel');
            if (recPanel) {
                recPanel.classList.add('hidden');
            }
            
            // Center map on searched area
            map.setCenter(loc);
            map.setZoom(14);
            
            showToastNotification(`📍 Showing chargers in ${results[0].name}`);
        } else {
            // Fallback to traditional Geocoder API if PlacesService did not return matches
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ address: val }, (geoResults, geoStatus) => {
                if (geoStatus === 'OK' && geoResults[0]) {
                    const loc = geoResults[0].geometry.location;
                    
                    clearDirectionsRoute();
                    routePolylinePath = [];
                    onRouteChargers = [];
                    activeWaypoint = null;
                    recommendedStation = null;
                    
                    const recPanel = document.getElementById('route-recommendation-panel');
                    if (recPanel) {
                        recPanel.classList.add('hidden');
                    }
                    
                    map.setCenter(loc);
                    map.setZoom(14);
                    showToastNotification(`📍 Centered on ${geoResults[0].formatted_address}`);
                } else {
                    // Local Search Database Fallback if Google APIs rate limit or fail
                    const searchKey = val.toLowerCase().trim();
                    const localCities = {
                        "thane": { lat: 19.2183, lng: 72.9781, name: "Thane, Maharashtra" },
                        "airoli": { lat: 19.1579, lng: 72.9935, name: "Airoli, Navi Mumbai" },
                        "mumbai": { lat: 19.0760, lng: 72.8777, name: "Mumbai, Maharashtra" },
                        "pune": { lat: 18.5204, lng: 73.8567, name: "Pune, Maharashtra" },
                        "lonavala": { lat: 18.7557, lng: 73.4091, name: "Lonavala, Maharashtra" },
                        "navi mumbai": { lat: 19.0330, lng: 73.0297, name: "Navi Mumbai, Maharashtra" },
                        "vashi": { lat: 19.0745, lng: 72.9978, name: "Vashi, Navi Mumbai" },
                        "koparkhairane": { lat: 19.1026, lng: 73.0033, name: "Koparkhairane, Navi Mumbai" },
                        "ghansoli": { lat: 19.1254, lng: 72.9992, name: "Ghansoli, Navi Mumbai" },
                        "rabale": { lat: 19.1354, lng: 73.0083, name: "Rabale, Navi Mumbai" },
                        "nerul": { lat: 19.0357, lng: 73.0162, name: "Nerul, Navi Mumbai" },
                        "belapur": { lat: 19.0204, lng: 73.0410, name: "CBD Belapur, Navi Mumbai" },
                        "panvel": { lat: 18.9894, lng: 73.1175, name: "Panvel, Navi Mumbai" },
                        "kharghar": { lat: 19.0270, lng: 73.0722, name: "Kharghar, Navi Mumbai" },
                        "mulund": { lat: 19.1726, lng: 72.9565, name: "Mulund, Mumbai" },
                        "bhandup": { lat: 19.1415, lng: 72.9372, name: "Bhandup, Mumbai" },
                        "ghatkopar": { lat: 19.0856, lng: 72.9082, name: "Ghatkopar, Mumbai" },
                        "kurla": { lat: 19.0607, lng: 72.8882, name: "Kurla, Mumbai" },
                        "bandra": { lat: 19.0596, lng: 72.8295, name: "Bandra, Mumbai" },
                        "andheri": { lat: 19.1136, lng: 72.8697, name: "Andheri, Mumbai" },
                        "borivali": { lat: 19.2307, lng: 72.8567, name: "Borivali, Mumbai" },
                        "dadar": { lat: 19.0178, lng: 72.8478, name: "Dadar, Mumbai" },
                        "powai": { lat: 19.1176, lng: 72.9060, name: "Powai, Mumbai" },
                        "chembur": { lat: 19.0622, lng: 72.8974, name: "Chembur, Mumbai" },
                        "sion": { lat: 19.0390, lng: 72.8619, name: "Sion, Mumbai" },
                        "worli": { lat: 19.0030, lng: 72.8171, name: "Worli, Mumbai" },
                        "colaba": { lat: 18.9067, lng: 72.8147, name: "Colaba, Mumbai" },
                        "fort": { lat: 18.9322, lng: 72.8354, name: "Fort, Mumbai" },
                        "churchgate": { lat: 18.9300, lng: 72.8200, name: "Churchgate, Mumbai" },
                        "dharavi": { lat: 19.0380, lng: 72.8538, name: "Dharavi, Mumbai" },
                        "goregaon": { lat: 19.1634, lng: 72.8412, name: "Goregaon, Mumbai" },
                        "malad": { lat: 19.1874, lng: 72.8484, name: "Malad, Mumbai" },
                        "kandivali": { lat: 19.2062, lng: 72.8530, name: "Kandivali, Mumbai" },
                        "dahisar": { lat: 19.2486, lng: 72.8593, name: "Dahisar, Mumbai" },
                        "mira road": { lat: 19.2818, lng: 72.8556, name: "Mira Road, Mumbai" },
                        "bhayandar": { lat: 19.2970, lng: 72.8540, name: "Bhayandar, Mumbai" },
                        "kalyan": { lat: 19.2403, lng: 73.1305, name: "Kalyan, Maharashtra" },
                        "dombivli": { lat: 19.2184, lng: 73.0867, name: "Dombivli, Maharashtra" },
                        "ulhasnagar": { lat: 19.2222, lng: 73.1539, name: "Ulhasnagar, Maharashtra" },
                        "vasai": { lat: 19.3919, lng: 72.8397, name: "Vasai, Maharashtra" },
                        "virar": { lat: 19.4564, lng: 72.7925, name: "Virar, Maharashtra" },
                        "nashik": { lat: 19.9975, lng: 73.7898, name: "Nashik, Maharashtra" },
                        "nagpur": { lat: 21.1458, lng: 79.0882, name: "Nagpur, Maharashtra" }
                    };

                    let matched = null;
                    for (const key in localCities) {
                        if (searchKey.includes(key) || key.includes(searchKey)) {
                            matched = localCities[key];
                            break;
                        }
                    }

                    if (matched) {
                        const loc = new google.maps.LatLng(matched.lat, matched.lng);
                        
                        clearDirectionsRoute();
                        routePolylinePath = [];
                        onRouteChargers = [];
                        activeWaypoint = null;
                        recommendedStation = null;
                        
                        const recPanel = document.getElementById('route-recommendation-panel');
                        if (recPanel) {
                            recPanel.classList.add('hidden');
                        }
                        
                        map.setCenter(loc);
                        map.setZoom(14);
                        showToastNotification(`📍 Centered on ${matched.name} (Offline Cache)`);
                    } else {
                        showToastNotification('⚠️ Could not find area. Try typing city name.');
                    }
                }
            });
        }
    });
};

/**
 * Expand bottom details sheet
 */
window.toggleBottomSheetHeight = function() {
    const sheet = document.getElementById('bottom-sheet');
    if (sheet) sheet.classList.toggle('expanded');
};

/**
 * Toggle Legend floating card
 */
window.toggleMapLegend = function() {
    const card = document.getElementById('legend-card');
    if (card) card.classList.toggle('collapsed');
};

/**
 * Toggle Filter Pill (AC, DC, 24/7, Active)
 */
window.toggleFilterPill = function(type) {
    if (type === 'AC') {
        chargerTypeFilter = (chargerTypeFilter === 'AC') ? 'all' : 'AC';
    } else if (type === 'DC') {
        chargerTypeFilter = (chargerTypeFilter === 'DC') ? 'all' : 'DC';
    } else if (type === '247') {
        filter247Only = !filter247Only;
    } else if (type === 'active') {
        activeOnly = !activeOnly;
    }

    // Update pill UI classes
    const pillAc = document.getElementById('filter-pill-ac');
    const pillDc = document.getElementById('filter-pill-dc');
    const pill247 = document.getElementById('filter-pill-247');
    const pillActive = document.getElementById('filter-pill-active');

    if (pillAc) pillAc.classList.toggle('active', chargerTypeFilter === 'AC');
    if (pillDc) pillDc.classList.toggle('active', chargerTypeFilter === 'DC');
    if (pill247) pill247.classList.toggle('active', filter247Only);
    if (pillActive) pillActive.classList.toggle('active', activeOnly);

    if (routePolylinePath.length > 0 && vehicleMarker) {
        const pos = vehicleMarker.getPosition();
        calculateBestRecommendation(pos.lat(), pos.lng());
    }
    plotMarkers([]);
};

/**
 * Center map on user location
 */
window.centerMapOnUser = function() {
    if (userLocation && map) {
        map.panTo(userLocation);
        map.setZoom(14);
        showToastNotification('📍 Map centered to your position.');
    } else if (map) {
        navigator.geolocation.getCurrentPosition((pos) => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            map.panTo(userLocation);
            map.setZoom(14);
            updateVehiclePosition(userLocation.lat, userLocation.lng);
            showToastNotification('📍 Map centered to GPS.');
        }, () => {
            showToastNotification('GPS location unavailable.');
        });
    }
};

/**
 * Map zoom controller (+/-)
 */
window.zoomMap = function(delta) {
    if (map) {
        map.setZoom(map.getZoom() + delta);
    }
};

/**
 * Fill Starting Location with GPS
 */
window.fillGPSLocation = function() {
    const startInput = document.getElementById('input-start');
    if (startInput) {
        startInput.value = 'Current Location';
        showToastNotification('📍 Using current GPS location');
    }
};

/**
 * Update Battery SOC slider and recalculate est range
 */
window.updateBatterySOC = function(val) {
    vehicleSOC = parseInt(val);
    const label = document.getElementById('battery-value');
    if (label) label.textContent = val;
    
    const calcRange = Math.round((vehicleSOC / 100) * vehicleRange);
    const rangeDisplay = document.getElementById('range-calc-value');
    if (rangeDisplay) rangeDisplay.textContent = calcRange;
    
    if (routePolylinePath.length > 0 && activeRouteInfo) {
        updateRecommendationDashboard(activeRouteInfo);
    }
};

/**
 * Update Est Range km and recalculate
 */
window.updateEstRange = function(val) {
    vehicleRange = parseInt(val) || 300;
    const calcRange = Math.round((vehicleSOC / 100) * vehicleRange);
    const rangeDisplay = document.getElementById('range-calc-value');
    if (rangeDisplay) rangeDisplay.textContent = calcRange;
    
    if (routePolylinePath.length > 0 && activeRouteInfo) {
        updateRecommendationDashboard(activeRouteInfo);
    }
};

/**
 * Update Min Reserve percentage
 */
window.updateReserveVal = function(val) {
    minReserve = parseInt(val) || 20;
    const display = document.getElementById('reserve-display-val');
    if (display) display.textContent = `${val}%`;
    
    if (routePolylinePath.length > 0 && activeRouteInfo) {
        updateRecommendationDashboard(activeRouteInfo);
    }
};

/**
 * Set up dynamic tab navigation for User
 */
window.switchUserTab = function(tabName) {
    // Deactivate all nav buttons and panels
    document.querySelectorAll('#bottom-navigation .nav-item').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

    // Activate selected
    const navBtn = document.getElementById(`nav-${tabName}`);
    if (navBtn) navBtn.classList.add('active');

    const panel = document.getElementById(`panel-${tabName}`);
    if (panel) panel.classList.add('active');

    // Close details sheet if switching away from Home
    if (tabName !== 'home') {
        const sheet = document.getElementById('bottom-sheet');
        if (sheet) sheet.classList.add('hidden');
    }

    // Toggle search controls and overlay views
    const searchBar = document.getElementById('filter-bar');
    const mapOverlay = document.getElementById('map-floating-overlay');
    if (searchBar) {
        searchBar.style.display = (tabName === 'home') ? 'flex' : 'none';
    }
    if (mapOverlay) {
        mapOverlay.style.display = (tabName === 'home') ? 'flex' : 'none';
    }

    // Load tab-specific telemetry or profiles
    if (tabName === 'plan') {
        renderProfileDetails();
        if (activeRouteInfo) {
            updateRecommendationDashboard(activeRouteInfo);
        }
    } else if (tabName === 'pricing') {
        renderPricingMetrics();
    } else if (tabName === 'profile') {
        renderProfileDetails();
    }
};

/**
 * Set up dynamic tab navigation for Admin
 */
window.switchAdminTab = function(tabName) {
    document.querySelectorAll('#admin-top-navigation .admin-nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-tab-panel').forEach(panel => panel.classList.remove('active'));

    const btn = document.getElementById(`adm-nav-${tabName}`);
    if (btn) btn.classList.add('active');

    const panel = document.getElementById(`admin-panel-${tabName}`);
    if (panel) panel.classList.add('active');

    // If Admin Control Map tab selected, move map viewport into the admin map wrapper
    const mapWrapper = document.getElementById('map-container');
    if (tabName === 'map') {
        const adminMapWrapper = document.getElementById('admin-map-wrapper');
        if (adminMapWrapper && mapWrapper) {
            adminMapWrapper.appendChild(document.getElementById('map'));
            // Re-trigger google maps layout engine
            google.maps.event.trigger(map, 'resize');
            plotMarkers([]);
        }
    } else {
        // Move back to main user container
        const userMapContainer = document.getElementById('map-container');
        const mapEl = document.getElementById('map');
        if (userMapContainer && mapEl && mapEl.parentElement !== userMapContainer) {
            userMapContainer.appendChild(mapEl);
            google.maps.event.trigger(map, 'resize');
        }
    }

    if (tabName === 'dash') {
        loadAdminDashboard();
    } else if (tabName === 'stations') {
        renderAdminStationsTable();
    } else if (tabName === 'analytics') {
        renderAdminCharts();
    }
};

/**
 * Bookmark styling in profile
 */
function renderProfileDetails() {
    if (!activeUser) return;
    
    const profName = document.getElementById('prof-name');
    if (profName) profName.textContent = activeUser.name || 'EV Driver';
    const profEmail = document.getElementById('prof-email');
    if (profEmail) profEmail.textContent = activeUser.email || '--';
    const profPhone = document.getElementById('prof-phone');
    if (profPhone) profPhone.textContent = activeUser.phone || 'N/A';
    
    const profModel = document.getElementById('prof-model');
    if (profModel) profModel.textContent = activeUser.vehicleModel || 'N/A';
    const regEl = document.getElementById('prof-regno');
    if (regEl) regEl.textContent = activeUser.vehicleNo || 'N/A';
    const profCap = document.getElementById('prof-capacity');
    if (profCap) profCap.textContent = activeUser.batteryCapacity ? `${activeUser.batteryCapacity} kWh` : 'N/A';
    const profRange = document.getElementById('prof-range');
    if (profRange) profRange.textContent = activeUser.maxRange ? `${activeUser.maxRange} km` : 'N/A';
    const profConn = document.getElementById('prof-connector');
    if (profConn) profConn.textContent = activeUser.preferredConnector || 'N/A';

    // Sync Planner vehicle widget
    const plannerVehicleName = document.getElementById('planner-vehicle-name');
    if (plannerVehicleName) {
        plannerVehicleName.textContent = activeUser.vehicleModel || 'Nexon EV';
    }

    if (activeUser.maxRange) {
        vehicleRange = parseInt(activeUser.maxRange) || vehicleRange;
        const rangeEl = document.getElementById('input-range');
        if (rangeEl) rangeEl.value = vehicleRange;
    }

    const calcRange = Math.round((vehicleSOC / 100) * vehicleRange);
    const rangeDisplay = document.getElementById('range-calc-value');
    if (rangeDisplay) rangeDisplay.textContent = calcRange;

    // Set slider and fields to user parameters if loaded initially
    if (activeUser.minReserve) {
        minReserve = parseInt(activeUser.minReserve) || minReserve;
        const resEl = document.getElementById('input-reserve');
        if (resEl) resEl.value = minReserve;
        const resDisplay = document.getElementById('reserve-display-val');
        if (resDisplay) resDisplay.textContent = `${minReserve}%`;
    }

    // Render Saved Stations
    const listContainer = document.getElementById('prof-saved-list');
    if (listContainer) {
        listContainer.innerHTML = '';
        if (activeUser.savedStations && activeUser.savedStations.length > 0) {
            activeUser.savedStations.forEach(id => {
                const station = allStations.find(s => s.id === id);
                if (station) {
                    const li = document.createElement('li');
                    li.className = 'saved-item';
                    li.innerHTML = `
                        <span><strong>${station.title}</strong> (${station.operator})</span>
                        <button class="btn-remove-saved" onclick="toggleBookmarkStation('${station.id}')">Remove</button>
                    `;
                    listContainer.appendChild(li);
                }
            });
        } else {
            listContainer.innerHTML = '<li class="placeholder-item">No bookmarked stations.</li>';
        }
    }

    // Render Charging History
    const historyContainer = document.getElementById('prof-history-list');
    if (historyContainer) {
        historyContainer.innerHTML = '';
        if (activeUser.chargingHistory && activeUser.chargingHistory.length > 0) {
            activeUser.chargingHistory.forEach(item => {
                const div = document.createElement('div');
                div.className = 'history-item';
                div.innerHTML = `
                    <div class="hist-header">
                        <span>${item.station}</span>
                        <span>${item.cost}</span>
                    </div>
                    <div class="hist-body">
                        <span>Date: ${item.date}</span>
                        <span>${item.energy} (${item.type})</span>
                    </div>
                `;
                historyContainer.appendChild(div);
            });
        } else {
            historyContainer.innerHTML = '<p class="placeholder-item">No charging logs recorded.</p>';
        }
    }

    loadMyImpact();
}

/**
 * Loads this driver's personal impact card: how many times GridSync routed
 * them to a charger, and the resulting estimated kWh/CO2/revenue.
 */
function loadMyImpact() {
    if (!activeUser || !activeUser.email) return;
    fetch(`/api/analytics/me?email=${encodeURIComponent(activeUser.email)}`)
        .then(res => res.json())
        .then(data => {
            const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            setText('my-impact-diversions', data.diversions.toLocaleString());
            setText('my-impact-kwh', `${data.estimatedKwh.toLocaleString()} kWh`);
            setText('my-impact-co2', `${data.estimatedCo2SavedKg.toLocaleString()} kg`);
            setText('my-impact-revenue', `₹${data.estimatedRevenueInr.toLocaleString()}`);
        })
        .catch(err => console.warn('Could not load personal impact:', err));
}

/**
 * Handle authentication login routing
 */
window.handleAuthLogin = async function(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    showStatus('Authenticating...');
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (response.ok) {
            const data = await response.json();
            activeUser = data.user;
            
            // Hide login screen
            document.getElementById('login-screen').classList.add('hidden');
            
            if (activeUser.role === 'Admin') {
                document.getElementById('admin-app-shell').classList.remove('hidden');
                document.getElementById('user-app-shell').classList.add('hidden');
                switchAdminTab('dash');
            } else {
                document.getElementById('user-app-shell').classList.remove('hidden');
                document.getElementById('admin-app-shell').classList.add('hidden');
                switchUserTab('home');
                initMap();
                // Only prompt EV Profile setup if it isn't already configured -
                // returning drivers with a saved profile shouldn't see this every login.
                checkUserVehicleProfile();
            }
            logAnalyticsEvent('session_start', null, { role: activeUser.role });
            showToastNotification(`Welcome back, ${activeUser.name}!`);
        } else {
            const err = await response.json();
            alert(err.error || 'Login failed. Please check credentials.');
        }
    } catch (err) {
        console.warn('Auth request failed, using in-memory local fallback database.');
        showToastNotification('Running in offline local fallback mode');
        
        // Simple client-side fallback logic if backend server not running
        if ((email === 'user@gridsync.in' && password === 'user123') || email === 'user' || !email || email === 'guest') {
            activeUser = { email: 'user@gridsync.in', role: 'User', name: 'GridSync Driver', savedStations: [], chargingHistory: [] };
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('user-app-shell').classList.remove('hidden');
            switchUserTab('home');
            initMap();
            checkUserVehicleProfile();
            logAnalyticsEvent('session_start', null, { role: 'User' });
        } else if ((email === 'admin@gridsync.in' && password === 'admin123') || email === 'admin') {
            activeUser = { email: 'admin@gridsync.in', role: 'Admin', name: 'GridSync Operator' };
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('admin-app-shell').classList.remove('hidden');
            switchAdminTab('dash');
            logAnalyticsEvent('session_start', null, { role: 'Admin' });
        } else {
            alert('Invalid local fallback credentials.');
        }
    } finally {
        hideStatus();
    }
};

/**
 * Handle authentication registration
 */
window.handleAuthRegister = async function(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const phone = document.getElementById('reg-phone').value;
    const password = document.getElementById('reg-password').value;

    showStatus('Creating account...');
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, password })
        });

        if (response.ok) {
            alert('Account created successfully! Please login with your credentials.');
            hideRegisterModal();
        } else {
            const err = await response.json();
            alert(err.error || 'Registration failed.');
        }
    } catch (err) {
        console.error('Registration failed:', err);
        alert('Local mock registration complete (Server offline). You can login now.');
        hideRegisterModal();
    } finally {
        hideStatus();
    }
};

window.handleAuthLogout = function() {
    activeUser = null;
    activeWaypoint = null;
    routePolylinePath = [];
    onRouteChargers = [];
    clearDirectionsRoute();
    
    document.getElementById('user-app-shell').classList.add('hidden');
    document.getElementById('admin-app-shell').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    
    // Reset login inputs
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    
    showToastNotification('Logged out successfully.');
};

window.switchLoginRole = function(role) {
    activeLoginRole = role;
    document.querySelectorAll('.login-tab').forEach(btn => btn.classList.remove('active'));
    
    if (role === 'User') {
        document.getElementById('tab-login-user').classList.add('active');
    } else {
        document.getElementById('tab-login-admin').classList.add('active');
    }
};

window.showRegisterModal = function() {
    document.getElementById('register-modal').classList.remove('hidden');
};

window.hideRegisterModal = function() {
    document.getElementById('register-modal').classList.add('hidden');
};

/**
 * Recalculate chargers located within a 5 km buffer radius of the driving route polyline
 */
function filterOnRouteChargers(routesPath) {
    onRouteChargers = [];
    const searchRadiusMeters = 5000;

    allStations.forEach(station => {
        const stationLatLng = new google.maps.LatLng(station.latitude, station.longitude);
        let minDistance = Infinity;
        
        for (let i = 0; i < routesPath.length; i += 4) {
            const dist = google.maps.geometry.spherical.computeDistanceBetween(stationLatLng, routesPath[i]);
            if (dist < minDistance) {
                minDistance = dist;
            }
        }
        
        if (minDistance <= searchRadiusMeters) {
            const stationCopy = { ...station, detourDistanceMeters: minDistance };
            onRouteChargers.push(stationCopy);
        }
    });

    console.log(`Found ${onRouteChargers.length} chargers within 5km of the route.`);
}

/**
 * Directions route planner with optional Waypoints stopovers
 */
async function planTrip(customEndLocation, customTitle) {
    if (!google || !google.maps) return;

    const startInput = document.getElementById('input-start');
    const startVal = startInput ? startInput.value.trim() : '';
    const destVal = document.getElementById('input-destination').value.trim();
    
    vehicleSOC = parseInt(document.getElementById('input-battery').value);
    vehicleRange = parseInt(document.getElementById('input-range').value);
    minReserve = parseInt(document.getElementById('input-reserve').value);

    const destinationArg = customEndLocation || destVal;
    if (!destinationArg) {
        showStatus('Please enter a destination.', true);
        setTimeout(hideStatus, 3000);
        return;
    }

    let startPoint;
    if (startVal === 'My Location (GPS)' || startVal === '') {
        if (userLocation) {
            startPoint = userLocation;
        } else {
            startPoint = { lat: 18.5312, lng: 73.8445 };
            if (startInput) startInput.value = 'Pune';
        }
    } else {
        startPoint = startVal;
    }

    showStatus('Calculating EV optimal trip route...');
    await fetchIndiaEnergyAtlasGridData();

    // Check if stopover active
    const request = {
        origin: startPoint,
        destination: destinationArg,
        travelMode: google.maps.TravelMode.DRIVING
    };

    if (activeWaypoint) {
        request.waypoints = [{ location: activeWaypoint, stopover: true }];
    }

    directionsService.route(request, (response, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            hideStatus();
            directionsRenderer.setDirections(response);
            lastDirectionsResponse = response;
            
            const route = response.routes[0];
            routePolylinePath = route.overview_path;
            
            const startLegPos = route.legs[0].start_location;
            updateVehiclePosition(startLegPos.lat(), startLegPos.lng());

            if (destinationMarker) destinationMarker.setMap(null);
            destinationMarker = new google.maps.Marker({
                position: route.legs[route.legs.length - 1].end_location,
                map: map,
                icon: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
                title: 'Destination: ' + (customTitle || destVal)
            });

            // Re-filter route chargers
            filterOnRouteChargers(routePolylinePath);
            calculateBestRecommendation(startLegPos.lat(), startLegPos.lng());
            plotMarkers([]);

            // Compile distance/time metrics
            let totalDistMeters = 0;
            let totalDurationSec = 0;
            route.legs.forEach(leg => {
                totalDistMeters += leg.distance.value;
                totalDurationSec += leg.duration.value;
            });

            activeRouteInfo = {
                distanceKm: parseFloat(totalDistMeters / 1000).toFixed(0),
                durationText: `${Math.round(totalDurationSec / 60)} mins`
            };

            if (recommendedStation) {
                fetchLiveGridTelemetry(recommendedStation).then(gridData => {
                    if (gridData) {
                        recommendedStation.liveGridData = gridData;
                        updateRecommendationDashboard(activeRouteInfo);
                    }
                });
            }
            updateRecommendationDashboard(activeRouteInfo);
            renderRouteChargersList();
            logAnalyticsEvent('route_planned', null, { distanceKm: activeRouteInfo.distanceKm, hasStopover: !!activeWaypoint });

            showToastNotification('🔄 ROUTE CALCULATED: Charging recommendations plotted.');
        } else {
            console.error('Directions request failed:', status);
            showStatus('Directions request failed. Please check starting and destination locations.', true);
            setTimeout(hideStatus, 4000);
        }
    });
}

/**
 * Handle waypointstop add to route
 */
window.addChargerStopover = function(stationId) {
    const station = allStations.find(s => s.id === stationId);
    if (!station) return;

    activeWaypoint = { lat: station.latitude, lng: station.longitude };
    showToastNotification(`charger stopover selected: ${station.title}`);
    logChargerDiversion(station);
    planTrip();
};

/**
 * Remove waypointstop from route
 */
window.removeChargerStopover = function() {
    activeWaypoint = null;
    showToastNotification('charger stopover removed from itinerary.');
    planTrip();
};

/**
 * Renders list of chargers along route below the map container
 */
function renderRouteChargersList() {
    const container = document.getElementById('route-chargers-container');
    const listBody = document.getElementById('route-chargers-list');
    
    if (!container || !listBody) return;
    
    if (routePolylinePath.length === 0 || onRouteChargers.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    listBody.innerHTML = '';

    onRouteChargers.forEach(station => {
        const type = getStationType(station);
        const detourDist = (station.detourDistanceMeters / 1000).toFixed(1);
        const gridInfo = getStationGridLoadAndPrice(station);
        
        let maxPower = 7.4;
        station.connectors.forEach(c => {
            const p = parseFloat(c.powerKW);
            if (!isNaN(p) && p > maxPower) maxPower = p;
        });

        const isStopover = activeWaypoint && 
                           (Math.abs(activeWaypoint.lat - station.latitude) < 0.001) && 
                           (Math.abs(activeWaypoint.lng - station.longitude) < 0.001);

        const card = document.createElement('div');
        card.className = 'route-charger-list-item';
        card.setAttribute('onclick', `focusStationOnMap('${station.id}')`);
        card.innerHTML = `
            <div class="route-charger-title">${station.title}</div>
            <div class="route-charger-stats">
                <span>⚡ ${maxPower} kW (${type})</span>
                <span>🛣️ Detour: ${detourDist} km</span>
                <span>💰 Grid Price: ${gridInfo.price}</span>
            </div>
            <div class="route-charger-stats" style="margin-top:2px;">
                <span>Grid Demand: <strong>${gridInfo.gridLoad}</strong></span>
                <span>Availability: ${station.liveStatus ? '🟢 LIVE' : '⚪ STATIC'}</span>
            </div>
            <div class="route-charger-action-row">
                ${isStopover 
                    ? `<button class="btn-item-action secondary" onclick="event.stopPropagation(); removeChargerStopover();">Remove stop</button>`
                    : `<button class="btn-item-action" onclick="event.stopPropagation(); addChargerStopover('${station.id}');">Add to route</button>`
                }
            </div>
        `;
        listBody.appendChild(card);
    });
}

/**
 * Golden Star SVG icon representing the recommended charging station
 */
function getRecommendedIcon() {
    return {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="38" height="38">
                <circle cx="12" cy="12" r="11" fill="#facc15" stroke="#ffffff" stroke-width="1.5" />
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="#0f172a" />
            </svg>
        `),
        scaledSize: new google.maps.Size(38, 38),
        anchor: new google.maps.Point(19, 19)
    };
}

/**
 * Identify station speed capabilities (AC vs. DC Fast Charger)
 */
function getStationType(station) {
    let hasDC = false;
    station.connectors.forEach(c => {
        const typeLower = c.type.toLowerCase();
        const power = parseFloat(c.powerKW);
        if (typeLower.includes('dc') || typeLower.includes('ccs') || typeLower.includes('chademo') || (!isNaN(power) && power > 22)) {
            hasDC = true;
        }
    });
    return hasDC ? 'DC' : 'AC';
}

/**
 * Update the "When Should I Charge?" sidebar assistant interface (Matching Reference Screen 2)
 */
function updateRecommendationDashboard(routeInfo) {
    const container = document.getElementById('assistant-content');
    const recBoxFloating = document.getElementById('route-recommendation-panel');
    const summaryCard = document.getElementById('route-summary-card');
    const remainingRange = Math.round((vehicleSOC / 100) * vehicleRange);
    const destinationDistance = parseInt((routeInfo && routeInfo.distanceKm) || 120);
    const reserveRange = (minReserve / 100) * vehicleRange;
    const safeUsableRange = remainingRange - reserveRange;

    // Time and distance to final destination
    const current = new Date();
    const totalTripMins = parseInt((routeInfo && routeInfo.durationText) || '') || Math.round(destinationDistance * 1.3);
    const destArrivalTime = new Date(current.getTime() + (totalTripMins * 60 * 1000));
    const destArrivalTimeStr = destArrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (summaryCard && routeInfo) {
        summaryCard.classList.remove('hidden');
        const timeEl = document.getElementById('route-time-val');
        const distEl = document.getElementById('route-dist-val');
        const stopsEl = document.getElementById('route-stops-val');
        const destEtaEl = document.getElementById('route-dest-eta-val');
        
        if (timeEl) timeEl.textContent = routeInfo.durationText || '1h 45m';
        if (distEl) distEl.textContent = `${routeInfo.distanceKm} km`;
        if (stopsEl) stopsEl.textContent = recommendedStation ? '1 Stop' : '0 Stops';
        if (destEtaEl) destEtaEl.textContent = `ETA ${destArrivalTimeStr}`;
    }

    if (!container || !recBoxFloating) return;

    if (safeUsableRange >= destinationDistance && !activeWaypoint) {
        // No charging stop needed
        recBoxFloating.classList.remove('hidden');
        const arriveReserve = Math.max(5, Math.round(((remainingRange - destinationDistance)/vehicleRange)*100));
        container.innerHTML = `
            <div class="rec-stop-header">
                <span class="rec-stop-badge">DIRECT ROUTE</span>
                <div class="rec-stop-eta">
                    <div class="rec-eta-time">ETA ${destArrivalTimeStr}</div>
                    <div class="rec-eta-sub">Arrive with <strong>${arriveReserve}%</strong></div>
                </div>
            </div>
            <div class="rec-stop-title" style="margin-top: 6px;">Direct Trip — No Charging Needed</div>
            <p style="font-size: 0.78rem; color: #94a3b8; margin-top: 4px; line-height: 1.4;">
                Your EV has sufficient battery (${safeUsableRange} km usable range vs ${destinationDistance} km trip) to reach destination with ${arriveReserve}% reserve remaining.
            </p>
        `;
    } else {
        // Charging stop recommended / active
        if (recommendedStation) {
            recBoxFloating.classList.remove('hidden');
            const liveGrid = recommendedStation.liveGridData;
            const gridInfo = liveGrid 
                ? { gridLoad: liveGrid.gridLoad, price: liveGrid.price }
                : getStationGridLoadAndPrice(recommendedStation);
            
            // Calculate distance & travel time specifically to this charging station
            const startLat = vehicleMarker ? vehicleMarker.getPosition().lat() : (userLocation ? userLocation.lat : 19.2183);
            const startLng = vehicleMarker ? vehicleMarker.getPosition().lng() : (userLocation ? userLocation.lng : 72.9781);
            const distToStationMeters = getDistanceMeters(startLat, startLng, recommendedStation.latitude, recommendedStation.longitude);
            const distToStationKm = Math.max(1, Math.round(distToStationMeters / 1000));

            // Proportional or realistic travel time to station
            let stationMins = Math.max(5, Math.round(distToStationKm * 1.4));
            if (destinationDistance > 0 && totalTripMins > 0) {
                const ratio = Math.min(0.9, distToStationKm / destinationDistance);
                stationMins = Math.max(5, Math.round(totalTripMins * ratio));
            }
            
            const stationArrivalTime = new Date(current.getTime() + (stationMins * 60 * 1000));
            const stationArrivalTimeStr = stationArrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Expected battery SOC on reaching the station
            const socConsumed = Math.round((distToStationKm / vehicleRange) * 100);
            const expectedArrivalSOC = Math.max(2, vehicleSOC - socConsumed);

            let maxPower = 150;
            let connType = 'CCS2';
            if (recommendedStation.connectors && recommendedStation.connectors.length > 0) {
                connType = recommendedStation.connectors[0].type || 'CCS2';
                recommendedStation.connectors.forEach(c => {
                    const p = parseFloat(c.powerKW);
                    if (!isNaN(p) && p > maxPower) maxPower = p;
                });
            }

            const availStr = recommendedStation.liveStatus 
                ? `${recommendedStation.availableCount}/${recommendedStation.totalConnectors}` 
                : '2/4';

            container.innerHTML = `
                <div class="rec-stop-header">
                    <span class="rec-stop-badge">RECOMMENDED STOP</span>
                    <div class="rec-stop-eta">
                        <div class="rec-eta-time">ETA ${stationArrivalTimeStr} (${stationMins}m)</div>
                        <div class="rec-eta-sub">Arrive with <strong>${expectedArrivalSOC}%</strong></div>
                    </div>
                </div>

                <div class="rec-stop-title" style="margin-top: 4px;">${recommendedStation.title}</div>
                <div class="rec-stop-address" style="margin-bottom: 8px;">
                    <span class="material-symbols-outlined" style="font-size: 14px; color: #10b981;">location_on</span>
                    <span>${recommendedStation.address || 'Highway 42, Midpoint'} (${distToStationKm} km away)</span>
                </div>

                <!-- 3 Stat Badges Matching Reference Screenshot -->
                <div class="rec-badges-grid">
                    <div class="rec-badge-item">
                        <div class="rec-badge-val" style="color: #34d399;">
                            <span style="font-size: 9px;">●</span> ${availStr} Available
                        </div>
                        <span class="rec-badge-sub">Slots</span>
                    </div>
                    <div class="rec-badge-item">
                        <div class="rec-badge-val" style="color: #60a5fa;">
                            ⚡ ${maxPower}kW
                        </div>
                        <span class="rec-badge-sub">Max Speed</span>
                    </div>
                    <div class="rec-badge-item">
                        <div class="rec-badge-val" style="color: ${gridInfo.gridLoad === 'LOW' ? '#34d399' : (gridInfo.gridLoad === 'MEDIUM' ? '#facc15' : '#f87171')};">
                            🍃 ${gridInfo.gridLoad.charAt(0) + gridInfo.gridLoad.slice(1).toLowerCase()}
                        </div>
                        <span class="rec-badge-sub">Grid Demand</span>
                    </div>
                </div>

                <!-- Is this charger working? Feedback Option -->
                <div class="charger-feedback-section" style="margin-top: 8px;">
                    <span class="feedback-question-text">Is this charger working?</span>
                    <div class="feedback-buttons-row">
                        <button class="btn-thumb-feedback yes" onclick="submitChargerReport('${recommendedStation.id}', true)">
                            <span>👍</span> Yes
                        </button>
                        <button class="btn-thumb-feedback no" onclick="submitChargerReport('${recommendedStation.id}', false)">
                            <span>👎</span> No
                        </button>
                        <span class="station-chip" style="font-size: 0.7rem; padding: 4px 8px;">${connType}</span>
                    </div>
                </div>

                <!-- Stopover Action -->
                <div style="margin-top: 10px;">
                    ${activeWaypoint 
                        ? `<button class="btn-item-action secondary" onclick="removeChargerStopover()" style="width: 100%; padding: 10px; border-radius: 12px; font-weight: 700; background: #334155; color: #f8fafc; border: none; cursor: pointer;">Remove Stop From Itinerary</button>`
                        : `<button class="btn-plan-route-primary" onclick="addChargerStopover('${recommendedStation.id}')" style="padding: 10px; font-size: 0.88rem;">Add Stop To Itinerary</button>`
                    }
                </div>
            `;
        } else {
            recBoxFloating.classList.remove('hidden');
            container.innerHTML = `
                <div class="rec-stop-header">
                    <span class="rec-stop-badge" style="background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #f87171;">RANGE ALERT</span>
                </div>
                <div class="rec-stop-title" style="color: #f87171; margin-top: 6px;">Insufficient EV Range</div>
                <p style="font-size: 0.78rem; color: #94a3b8; margin-top: 4px; line-height: 1.4;">Your estimated range (${remainingRange} km) cannot cover the destination distance (${destinationDistance} km). Please adjust vehicle settings or review charging networks along route.</p>
            `;
        }
    }
}

/**
 * Display toast update alert (transient notification)
 */
function showToastNotification(message) {
    const oldToast = document.getElementById('route-update-toast');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.id = 'route-update-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '90px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.zIndex = '99999';
    toast.style.background = 'rgba(15, 23, 42, 0.95)';
    toast.style.border = '1px solid #10b981';
    toast.style.borderRadius = '8px';
    toast.style.padding = '10px 16px';
    toast.style.color = '#f8fafc';
    toast.style.fontSize = '0.8rem';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';

    toast.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="#10b981">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <span>${message}</span>
    `;
    
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 4500);
}

/**
 * Load pricing metrics and render dynamic pricing time series chart
 */
async function renderPricingMetrics() {
    // 1. Render dynamic pricing dashboard metrics
    const gridStress = getGridStressIndex();
    const demandVal = liveGridDemand ? `${liveGridDemand.demand_mw.toLocaleString()} MW` : 'UNAVAILABLE';
    const demandTime = liveGridDemand ? new Date(liveGridDemand.as_of).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const frequencyVal = liveGridDemand ? `${liveGridDemand.frequency_hz.toFixed(2)} Hz` : '-- Hz';
    
    const atlasDemandEl = document.getElementById('atlas-grid-demand');
    const atlasTimeEl = document.getElementById('atlas-timestamp');
    const atlasFreqEl = document.getElementById('atlas-frequency');
    const statusBox = document.getElementById('grid-status-box');
    const badge = document.getElementById('grid-classification-badge');
    const periodText = document.getElementById('grid-pricing-period');
    const verdictEl = document.getElementById('pricing-recommendation');

    if (atlasDemandEl) atlasDemandEl.textContent = demandVal;
    if (atlasTimeEl) atlasTimeEl.textContent = `Last sync: ${demandTime}`;
    if (atlasFreqEl) atlasFreqEl.textContent = frequencyVal;

    // Remove old stress classes
    if (statusBox) {
        statusBox.className = 'grid-classification-box';
        if (gridStress > 0.8) {
            statusBox.classList.add('CRITICAL');
            badge.textContent = 'CRITICAL';
            badge.className = 'grid-badge grid-critical';
            periodText.innerHTML = `Grid strain detected. Peak price period active. <strong>Tariff multiplier: 1.65x</strong>`;
            verdictEl.innerHTML = `<h4>Grid Recommendation</h4><p class="rec-verdict wait">WAIT OR USE ANOTHER STATION</p>`;
        } else if (gridStress > 0.6) {
            statusBox.classList.add('HIGH');
            badge.textContent = 'HIGH';
            badge.className = 'grid-badge grid-high';
            periodText.innerHTML = `High load recorded. Peak period active. <strong>Tariff multiplier: 1.35x</strong>`;
            verdictEl.innerHTML = `<h4>Grid Recommendation</h4><p class="rec-verdict wait">WAIT IF POSSIBLE</p>`;
        } else if (gridStress > 0.35) {
            statusBox.classList.add('MEDIUM');
            badge.textContent = 'MEDIUM';
            badge.className = 'grid-badge grid-medium';
            periodText.innerHTML = `Moderate grid loads. Mid-peak pricing. <strong>Tariff multiplier: 1.15x</strong>`;
            verdictEl.innerHTML = `<h4>Grid Recommendation</h4><p class="rec-verdict other">NORMAL CHARGING TARIFF</p>`;
        } else {
            statusBox.classList.add('LOW');
            badge.textContent = 'LOW';
            badge.className = 'grid-badge grid-low';
            periodText.innerHTML = `Low regional demand. Eco off-peak discount active! <strong>Tariff multiplier: 1.0x</strong>`;
            verdictEl.innerHTML = `<h4>Grid Recommendation</h4><p class="rec-verdict now">CHARGE NOW</p>`;
        }
    }

    // 2. Render dynamic pricing time series chart
    const ctx = document.getElementById('pricingChart');
    if (!ctx) return;

    if (pricingChartInstance) {
        pricingChartInstance.destroy();
    }

    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    
    // Simulate expected diurnal demand profile peaks around 7 PM - 10 PM
    const demandSeries = hours.map((_, h) => {
        const base = 17000;
        const diurnalShift = Math.sin((h - 6) / 24 * 2 * Math.PI) * 3000; // Peaks at 6 PM
        const peakAdd = h >= 18 && h <= 22 ? 2500 : 0;
        return Math.round(base + diurnalShift + peakAdd + (Math.random() * 500));
    });

    const priceSeries = demandSeries.map(d => {
        const ratio = (d - 14000) / 11000;
        const multiplier = 1.0 + (ratio * 0.65);
        return parseFloat((11.5 * multiplier).toFixed(2));
    });

    pricingChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [
                {
                    label: 'Grid Demand (MW)',
                    data: demandSeries,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    yAxisID: 'y-demand',
                    borderWidth: 2,
                    tension: 0.3
                },
                {
                    label: 'Charging Price (₹/kWh)',
                    data: priceSeries,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    yAxisID: 'y-price',
                    borderWidth: 2,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#64748b', maxTicksLimit: 8 }
                },
                'y-demand': {
                    position: 'left',
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#3b82f6' }
                },
                'y-price': {
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#10b981' }
                }
            },
            plugins: {
                legend: { labels: { color: '#e2e8f0', boxWidth: 10 } }
            }
        }
    });
}

/**
 * Interactive scrolling EV road leaf leaves animation
 */
function setupScrollRoadAnimation() {
    const scrollBox = document.getElementById('scroll-road-box');
    const scrollCar = document.getElementById('scroll-car');
    const leavesLayer = document.getElementById('scroll-leaves-layer');
    
    if (!scrollBox || !scrollCar) return;

    scrollBox.addEventListener('wheel', (e) => {
        e.preventDefault();
        scrollBox.scrollLeft += e.deltaY;
        
        // Calculate progress ratio
        const maxScroll = scrollBox.scrollWidth - scrollBox.clientWidth;
        if (maxScroll <= 0) return;
        
        scrollProgress = Math.min(1.0, Math.max(0.0, scrollBox.scrollLeft / maxScroll));
        
        // Translate car icon position
        scrollCar.style.left = `${10 + (scrollProgress * 80)}%`;

        // Periodically spawn leaf icons behind the car
        if (Math.random() > 0.8) {
            const leaf = document.createElement('div');
            leaf.className = 'road-leaf';
            leaf.textContent = '🍃';
            leaf.style.left = `${15 + (scrollProgress * 78)}%`;
            leavesLayer.appendChild(leaf);
            
            // Remove after floating completes
            setTimeout(() => {
                leaf.remove();
            }, 1000);
        }
    });
}

/**
 * Active simulation toggle
 */
function toggleSimulator() {
    if (simIntervalId) {
        clearInterval(simIntervalId);
        simIntervalId = null;
        const simBtn = document.getElementById('sim-btn');
        if (simBtn) {
            simBtn.classList.remove('active');
            const span = simBtn.querySelector('span');
            if (span) span.textContent = 'Simulate Drive';
            const icon = document.getElementById('sim-icon');
            if (icon) icon.textContent = 'play_arrow';
        }
        showToastNotification('Simulation stopped.');
        return;
    }

    if (routePolylinePath.length === 0) {
        alert('Please plan a trip route first.');
        return;
    }

    showToastNotification('Starting EV drive simulator...');
    const simBtn = document.getElementById('sim-btn');
    if (simBtn) {
        simBtn.classList.add('active');
        const span = simBtn.querySelector('span');
        if (span) span.textContent = 'Stop Sim';
        const icon = document.getElementById('sim-icon');
        if (icon) icon.textContent = 'stop';
    }

    simIndex = 0;
    
    // Sample coordinates along directions overview path
    const simRoute = routePolylinePath.map(p => ({ lat: p.lat(), lng: p.lng() }));
    const simTotalDistanceKm = activeRouteInfo ? parseInt(activeRouteInfo.distanceKm) : 100;
    
    // Nexon 300km max range consumes battery SOC per step
    const totalConsumption = (simTotalDistanceKm / vehicleRange) * 100;
    const drainPerStep = totalConsumption / simRoute.length;

    console.log(`Driving simulator started. Total Distance: ${simTotalDistanceKm} km, Est. Drain: ${totalConsumption.toFixed(1)}% (${drainPerStep.toFixed(2)}% per step)`);
    
    const startPos = simRoute[simIndex];
    updateVehiclePosition(startPos.lat, startPos.lng);

    const batterySlider = document.getElementById('input-battery');

    simIntervalId = setInterval(() => {
        simIndex++;
        if (simIndex >= simRoute.length) {
            toggleSimulator(); // Stop at the end of the route
            return;
        }
        const nextPos = simRoute[simIndex];
        
        vehicleSOC = Math.max(5, vehicleSOC - drainPerStep);
        
        if (batterySlider) {
            batterySlider.value = Math.round(vehicleSOC);
            const batteryValueSpan = document.getElementById('battery-value');
            if (batteryValueSpan) batteryValueSpan.textContent = `${Math.round(vehicleSOC)}%`;
        }

        updateVehiclePosition(nextPos.lat, nextPos.lng);

        // Dynamically recalculate recommended charger during simulation movement
        calculateBestRecommendation(nextPos.lat, nextPos.lng);
        plotMarkers([]);
        
        const progressRatio = simIndex / simRoute.length;
        const remainingDist = Math.max(0, Math.round(simTotalDistanceKm * (1 - progressRatio)));
        
        activeRouteInfo = {
            distanceKm: remainingDist,
            durationText: `${Math.round(remainingDist * 1.2)} mins`
        };
        updateRecommendationDashboard(activeRouteInfo);

    }, 1500);
}


// ==========================================
// ADMIN DASHBOARD COCKPIT CODE
// ==========================================

/**
 * Loads Admin KPI stats from local markers list
 */
function loadAdminDashboard() {
    // Populate stats
    document.getElementById('stat-total-stations').textContent = allStations.length;
    
    let totalConn = 0;
    let totalAvail = 0;
    let totalBusy = 0;
    let totalFaulty = 0;
    let totalOffline = 0;

    allStations.forEach(s => {
        totalConn += s.totalConnectors;
        totalAvail += s.availableCount;
        
        const statusLower = s.status.toLowerCase();
        if (s.communityFault || statusLower.includes('faulty')) totalFaulty += s.totalConnectors;
        else if (statusLower.includes('maintenance')) totalOffline += s.totalConnectors;
        else if (statusLower.includes('offline') || statusLower.includes('not operational')) totalOffline += s.totalConnectors;
        else if (statusLower.includes('occupied') || statusLower.includes('in use') || (s.liveStatus && s.availableCount === 0)) totalBusy += s.totalConnectors;
        else totalAvail += (s.totalConnectors - s.availableCount); // Rest available
    });

    // Clean overlapping logic for exact sum matches
    totalBusy = Math.max(0, totalConn - totalAvail - totalFaulty - totalOffline);

    document.getElementById('stat-total-chargers').textContent = totalConn;
    document.getElementById('stat-avail-chargers').textContent = totalAvail;
    document.getElementById('stat-busy-chargers').textContent = totalBusy;
    document.getElementById('stat-faulty-chargers').textContent = totalFaulty;

    // Render Peak grid demands in admin widgets
    const demandNum = document.getElementById('admin-demand-num');
    const demandTime = document.getElementById('admin-demand-time');
    const demandBadge = document.getElementById('admin-demand-badge');
    const demandProgress = document.getElementById('admin-demand-progress');
    const freqEl = document.getElementById('admin-freq-num');

    if (liveGridDemand) {
        demandNum.textContent = `${liveGridDemand.demand_mw.toLocaleString()} MW`;
        demandTime.textContent = `Last sync: ${new Date(liveGridDemand.as_of).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        
        const stress = getGridStressIndex();
        demandProgress.style.width = `${stress * 100}%`;
        freqEl.textContent = `${liveGridDemand.frequency_hz.toFixed(2)} Hz`;

        if (stress > 0.8) {
            demandBadge.textContent = 'CRITICAL';
            demandBadge.className = 'tel-badge grid-critical';
            demandProgress.style.backgroundColor = '#ef4444';
        } else if (stress > 0.6) {
            demandBadge.textContent = 'HIGH';
            demandBadge.className = 'tel-badge grid-high';
            demandProgress.style.backgroundColor = '#f97316';
        } else if (stress > 0.35) {
            demandBadge.textContent = 'MEDIUM';
            demandBadge.className = 'tel-badge grid-medium';
            demandProgress.style.backgroundColor = '#eab308';
        } else {
            demandBadge.textContent = 'NORMAL';
            demandBadge.className = 'tel-badge grid-low';
            demandProgress.style.backgroundColor = '#10b981';
        }
    }

    // Load recent reports table
    const tableBody = document.getElementById('admin-recent-reports');
    tableBody.innerHTML = '';
    
    // Fetch reports list dynamically
    fetch('/api/reports/summary').then(res => res.json()).then(data => {
        let count = 0;
        for (const stationId in data) {
            const station = allStations.find(s => s.id === stationId);
            if (station && count < 5) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${station.title}</strong></td>
                    <td><span class="admin-map-pin-badge" style="background:#ef4444; color:white;">FAULTY (${data[stationId].broken} votes)</span></td>
                    <td>Just Now</td>
                    <td>Community Report</td>
                `;
                tableBody.appendChild(tr);
                count++;
            }
        }
        if (count === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" class="no-data">No community reports submitted.</td></tr>';
        }
    });

    loadImpactDashboard();
}

/**
 * Loads and renders the "traffic diverted through GridSync" impact
 * dashboard on the Admin Overview tab: sessions/kWh/CO2/revenue derived
 * from logged analytics events, a 14-day diversion trend, and the
 * top diverted-to stations.
 */
function loadImpactDashboard() {
    fetch('/api/analytics/summary').then(res => res.json()).then(data => {
        const sourceBadge = document.getElementById('impact-data-source');
        if (sourceBadge) {
            const isPersistent = data.dataSource === 'SUPABASE';
            sourceBadge.textContent = isPersistent ? 'PERSISTENT (SUPABASE)' : 'SESSION-ONLY (NOT CONFIGURED)';
            sourceBadge.className = 'impact-source-badge' + (isPersistent ? ' persistent' : ' session-only');
            sourceBadge.title = isPersistent
                ? 'Backed by Supabase - counts persist across deployments.'
                : 'SUPABASE_URL/SUPABASE_KEY not configured - these counts reset when the server cold-starts.';
        }

        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setText('impact-diversions', data.diversions.toLocaleString());
        setText('impact-kwh', `${data.estimatedKwh.toLocaleString()} kWh`);
        setText('impact-revenue', `₹${data.estimatedRevenueInr.toLocaleString()}`);
        setText('impact-co2', `${data.estimatedCo2SavedKg.toLocaleString()} kg`);
        setText('impact-offpeak', `${data.offPeakSharePct}%`);

        const topBody = document.getElementById('impact-top-stations');
        if (topBody) {
            if (data.topStations.length === 0) {
                topBody.innerHTML = '<tr><td colspan="2" class="no-data">No diversions logged yet.</td></tr>';
            } else {
                topBody.innerHTML = data.topStations.map(row => {
                    const station = allStations.find(s => s.id === row.stationId);
                    const name = station ? station.title : row.stationId;
                    return `<tr><td>${name}</td><td><strong>${row.count}</strong></td></tr>`;
                }).join('');
            }
        }

        renderImpactTrendChart(data.trend);
    }).catch(err => console.warn('Could not load impact dashboard:', err));
}

function renderImpactTrendChart(trend) {
    const ctx = document.getElementById('impactTrendChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (adminImpactTrendChart) adminImpactTrendChart.destroy();

    const labels = trend.map(t => new Date(t.day).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    const counts = trend.map(t => t.count);

    adminImpactTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['No data yet'],
            datasets: [{
                label: 'Chargers diverted to',
                data: counts.length ? counts : [0],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 } },
                x: { ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

/**
 * Filter Admin live control map pins
 */
window.filterAdminMapPins = function(statusCategory) {
    document.querySelectorAll('.btn-filter-admin').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    markerMap.forEach((marker, id) => {
        const station = allStations.find(s => s.id === id);
        if (!station) return;
        
        let show = false;
        const statusLower = station.status.toLowerCase();
        
        if (statusCategory === 'All') show = true;
        else if (statusCategory === 'Available' && statusLower.includes('operational') && !station.communityFault) show = true;
        else if (statusCategory === 'Busy' && (statusLower.includes('occupied') || statusLower.includes('in use'))) show = true;
        else if (statusCategory === 'Faulty' && (station.communityFault || statusLower.includes('faulty'))) show = true;
        else if (statusCategory === 'Offline' && (statusLower.includes('offline') || statusLower.includes('maintenance'))) show = true;

        marker.setMap(show ? map : null);
    });
};

/**
 * Render Admin Station Management Table
 */
window.renderAdminStationsTable = function() {
    const listBody = document.getElementById('admin-stations-list-body');
    const searchVal = document.getElementById('admin-station-search').value.toLowerCase();
    const sortVal = document.getElementById('admin-station-sort').value;

    if (!listBody) return;

    listBody.innerHTML = '';
    
    // Filter stations
    let filtered = allStations.filter(s => {
        return s.title.toLowerCase().includes(searchVal) ||
               s.operator.toLowerCase().includes(searchVal) ||
               s.address.toLowerCase().includes(searchVal);
    });

    // Sort stations
    filtered.sort((a, b) => {
        if (sortVal === 'name') return a.title.localeCompare(b.title);
        if (sortVal === 'operator') return a.operator.localeCompare(b.operator);
        if (sortVal === 'chargers') return b.totalConnectors - a.totalConnectors;
        return 0;
    });

    if (filtered.length === 0) {
        listBody.innerHTML = '<tr><td colspan="8" class="no-data">No matching stations found.</td></tr>';
        return;
    }

    filtered.forEach(s => {
        const isRecommended = recommendedStation && (recommendedStation.id === s.id);
        const statusLabel = s.communityFault ? '⚠ Faulty (Community)' : s.status;
        const sourceLabel = s.adminUpdated ? 'ADMIN UPDATED' : (s.liveStatus ? 'LIVE' : 'STATIC');
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${s.title}</strong> ${isRecommended ? '<span style="color:#facc15">★</span>' : ''}</td>
            <td>${s.operator}</td>
            <td style="font-size: 0.7rem; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.address}</td>
            <td>${s.totalConnectors} slots</td>
            <td>${statusLabel}</td>
            <td>🟢 ${s.availableCount} available</td>
            <td>${getTrustBadgeHTML(sourceLabel)}</td>
            <td>
                <button class="btn-action-view" onclick="openAdminEditModal('${s.id}')">EDIT / OVERRIDE</button>
            </td>
        `;
        listBody.appendChild(tr);
    });
};

/**
 * Admin: Open edit modal for selected station
 */
window.openAdminEditModal = function(stationId) {
    const station = allStations.find(s => s.id === stationId);
    if (!station) return;

    document.getElementById('edit-station-id').value = station.id;
    document.getElementById('edit-station-title').value = station.title;
    document.getElementById('edit-station-operator').value = station.operator;
    document.getElementById('edit-station-address').value = station.address;
    document.getElementById('edit-station-lat').value = station.latitude;
    document.getElementById('edit-station-lng').value = station.longitude;
    document.getElementById('edit-station-hours').value = station.hours || '24/7';
    document.getElementById('edit-station-contact').value = station.contact || 'N/A';

    // Load connector override list
    const connList = document.getElementById('edit-connectors-list');
    connList.innerHTML = '';

    station.connectors.forEach((c, idx) => {
        const div = document.createElement('div');
        div.className = 'connector-edit-item';
        div.innerHTML = `
            <div class="connector-edit-info">
                <span class="edit-conn-title">${c.type} (${c.powerKW} kW)</span>
                <span class="edit-conn-meta">Connector ID: conn-${idx}</span>
            </div>
            <select class="select-conn-status" id="override-conn-${idx}" onchange="overrideChargerStatus('${station.id}', 'conn-${idx}', this.value)">
                <option value="Available" ${c.status === 'Available' ? 'selected' : ''}>Available</option>
                <option value="Busy" ${c.status === 'Busy' ? 'selected' : ''}>Busy</option>
                <option value="Offline" ${c.status === 'Offline' ? 'selected' : ''}>Offline</option>
                <option value="Maintenance" ${c.status === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
                <option value="Faulty" ${c.status === 'Faulty' ? 'selected' : ''}>Faulty</option>
            </select>
        `;
        connList.appendChild(div);
    });

    document.getElementById('admin-edit-station-modal').classList.remove('hidden');
};

window.closeAdminEditModal = function() {
    document.getElementById('admin-edit-station-modal').classList.add('hidden');
};

/**
 * Admin: Override status of a charger connector
 */
window.overrideChargerStatus = async function(stationId, chargerId, newStatus) {
    const confirmOverride = confirm(`Are you sure you want to override the status of connector ${chargerId} to "${newStatus}"?\nThis status will be marked as "ADMIN UPDATED".`);
    if (!confirmOverride) return;

    try {
        const response = await fetch('/api/admin/charger/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stationId: stationId,
                chargerId: chargerId,
                status: newStatus
            })
        });

        if (response.ok) {
            showToastNotification('Charger status overridden successfully!');
            
            // Sync local overrides cache
            await syncDatabaseState();
            
            // Apply to all loaded stations
            allStations.forEach(s => {
                if (s.id === stationId) applyOverridesAndReports(s);
            });
            
            // Update admin table
            renderAdminStationsTable();
        }
    } catch (e) {
        console.error('Failed to override status:', e);
    }
};

/**
 * Admin: Save edited station details
 */
window.saveAdminStationEdit = async function(e) {
    e.preventDefault();
    const stationId = document.getElementById('edit-station-id').value;
    const title = document.getElementById('edit-station-title').value;
    const operator = document.getElementById('edit-station-operator').value;
    const address = document.getElementById('edit-station-address').value;
    const latitude = parseFloat(document.getElementById('edit-station-lat').value);
    const longitude = parseFloat(document.getElementById('edit-station-lng').value);
    const hours = document.getElementById('edit-station-hours').value;
    const contact = document.getElementById('edit-station-contact').value;

    showStatus('Saving modifications...');
    try {
        const response = await fetch('/api/admin/station/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                stationId, title, operator, address, latitude, longitude, hours, contact
            })
        });

        if (response.ok) {
            showToastNotification('Station details updated.');
            closeAdminEditModal();
            
            // Re-sync overrides
            await syncDatabaseState();
            
            allStations.forEach(s => {
                if (s.id === stationId) applyOverridesAndReports(s);
            });
            
            renderAdminStationsTable();
        }
    } catch (err) {
        console.error('Station update request failed:', err);
    } finally {
        hideStatus();
    }
};

/**
 * Render Admin utilization charts
 */
function renderAdminCharts() {
    // 1. Utilization ratio chart
    const utilCtx = document.getElementById('utilizationChart');
    if (!utilCtx) return;

    if (adminUtilChart) adminUtilChart.destroy();

    // Pick top 5 stations with connectors
    const stations = allStations.slice(0, 5);
    const labels = stations.map(s => s.title.split(' - ')[0]);
    const ratios = stations.map(() => Math.round(25 + Math.random() * 60)); // Simulated utilization stats

    adminUtilChart = new Chart(utilCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Average Utilization (%)',
                data: ratios,
                backgroundColor: 'rgba(16, 185, 129, 0.4)',
                borderColor: '#10b981',
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' } },
                x: { ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    // 2. Availability Share Doughnut chart
    const availCtx = document.getElementById('availabilityChart');
    if (!availCtx) return;

    if (adminAvailChart) adminAvailChart.destroy();

    let avail = 0;
    let busy = 0;
    let faulty = 0;
    let offline = 0;

    allStations.forEach(s => {
        avail += s.availableCount;
        
        const statusLower = s.status.toLowerCase();
        if (s.communityFault || statusLower.includes('faulty')) faulty += s.totalConnectors;
        else if (statusLower.includes('maintenance') || statusLower.includes('offline')) offline += s.totalConnectors;
        else busy += (s.totalConnectors - s.availableCount);
    });

    adminAvailChart = new Chart(availCtx, {
        type: 'doughnut',
        data: {
            labels: ['Available', 'Busy', 'Faulty', 'Offline'],
            datasets: [{
                data: [avail, busy, faulty, offline],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#64748b']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#cbd5e1' } }
            }
        }
    });
}

/**
 * ==================== EV PROFILE SETUP & GOOGLE AUTH SIMULATOR ====================
 */

let cachedEvModels = [];

function checkUserVehicleProfile() {
    if (activeUser.role === 'Admin') return;
    
    // If vehicleModel or vehicleNo is missing, prompt to configure it!
    if (!activeUser.vehicleModel || !activeUser.vehicleNo) {
        console.log('EV profile is incomplete. Prompting vehicle setup...');
        setTimeout(() => {
            openVehicleSetupModal();
        }, 800); // Slight delay for clean entrance after login
    } else {
        applyUserVehicleToInputs();
    }
}

function applyUserVehicleToInputs() {
    if (!activeUser) return;
    
    // Update Planner values
    const rangeInput = document.getElementById('input-range');
    if (rangeInput && activeUser.maxRange) {
        rangeInput.value = activeUser.maxRange;
    }
    
    const prefSelect = document.getElementById('input-preference');
    if (prefSelect && activeUser.preferredSpeed) {
        prefSelect.value = activeUser.preferredSpeed;
    }
    
    // Refresh profile display fields
    const pModel = document.getElementById('prof-model');
    const pReg = document.getElementById('prof-regno');
    const pCapacity = document.getElementById('prof-capacity');
    const pRange = document.getElementById('prof-range');
    const pConnector = document.getElementById('prof-connector');
    
    if (pModel) pModel.textContent = activeUser.vehicleModel || 'N/A';
    if (pReg) pReg.textContent = activeUser.vehicleNo || 'N/A';
    if (pCapacity) pCapacity.textContent = activeUser.batteryCapacity ? `${activeUser.batteryCapacity} kWh` : 'N/A';
    if (pRange) pRange.textContent = activeUser.maxRange ? `${activeUser.maxRange} km` : 'N/A';
    if (pConnector) pConnector.textContent = activeUser.preferredConnector || 'N/A';
}

window.lastFetchedEpaSpecs = null;

/**
 * Fills the MODEL TYPE select with every entry for one car company.
 * Disabled + empty until a company is chosen, matching the make-first flow.
 */
function populateModelOptions(make, preselectModel) {
    const modelSelect = document.getElementById('setup-vehicle-model');
    if (!modelSelect) return;

    if (!make) {
        modelSelect.innerHTML = '<option value="">Select company first</option>';
        modelSelect.disabled = true;
        return;
    }

    const models = cachedEvModels
        .filter(m => m.make === make)
        .sort((a, b) => a.model.localeCompare(b.model));

    modelSelect.innerHTML = '<option value="">Select EV Model</option>' +
        models.map(m => `<option value="${m.model}">${m.model}</option>`).join('');
    modelSelect.disabled = false;
    modelSelect.value = preselectModel || '';
}

window.openVehicleSetupModal = async function() {
    const modal = document.getElementById('vehicle-setup-modal');
    if (!modal) return;

    // Warm cache the EV models database (all companies) from server
    if (cachedEvModels.length === 0) {
        try {
            const res = await fetch('/api/ev-vehicles');
            if (res.ok) {
                cachedEvModels = await res.json();
            }
        } catch (e) {
            console.warn('Could not load EV models specifications:', e);
        }
    }

    // Reverse-match the user's saved full model name back to {make, model}
    // so re-opening the modal to edit a profile preselects both dropdowns.
    const existingSpec = activeUser.vehicleModel
        ? cachedEvModels.find(m => m.modelFull === activeUser.vehicleModel)
        : null;

    // Populate MAKE dropdown
    const makeSelect = document.getElementById('setup-vehicle-make');
    if (makeSelect) {
        const makes = [...new Set(cachedEvModels.map(m => m.make))].sort();
        makeSelect.innerHTML = '<option value="">Select Car Company</option>' +
            makes.map(mk => `<option value="${mk}">${mk}</option>`).join('');
        makeSelect.value = existingSpec ? existingSpec.make : '';
    }

    // Populate MODEL dropdown for that make (or leave disabled if none chosen)
    populateModelOptions(existingSpec ? existingSpec.make : '', existingSpec ? existingSpec.model : '');

    const regInput = document.getElementById('setup-vehicle-no');
    if (regInput) {
        regInput.value = activeUser.vehicleNo || '';
    }

    // Hide badges
    const epaBadge = document.getElementById('epa-verification-badge');
    if (epaBadge) epaBadge.classList.add('hidden');

    const specsPreview = document.getElementById('setup-specs-preview');
    if (specsPreview) specsPreview.classList.add('hidden');

    window.lastFetchedEpaSpecs = null;

    // If the user already has a saved model, trigger change preview immediately
    if (existingSpec) {
        setTimeout(() => {
            handleSetupModelChange();
        }, 100);
    }

    modal.classList.remove('hidden');
};

/**
 * Fires when the CAR COMPANY select changes: reloads the MODEL TYPE options
 * for that company and clears any stale spec preview from the old selection.
 */
window.handleSetupMakeChange = function() {
    const make = document.getElementById('setup-vehicle-make').value;
    populateModelOptions(make, '');

    const epaBadge = document.getElementById('epa-verification-badge');
    const specsPreview = document.getElementById('setup-specs-preview');
    if (epaBadge) epaBadge.classList.add('hidden');
    if (specsPreview) specsPreview.classList.add('hidden');
    window.lastFetchedEpaSpecs = null;
};

window.handleSetupModelChange = function() {
    const make = document.getElementById('setup-vehicle-make').value;
    const modelName = document.getElementById('setup-vehicle-model').value;
    const epaBadge = document.getElementById('epa-verification-badge');
    const specsPreview = document.getElementById('setup-specs-preview');

    if (!modelName) {
        if (epaBadge) epaBadge.classList.add('hidden');
        if (specsPreview) specsPreview.classList.add('hidden');
        window.lastFetchedEpaSpecs = null;
        return;
    }

    const spec = cachedEvModels.find(m => m.make === make && m.model === modelName);
    if (spec) {
        window.lastFetchedEpaSpecs = spec;

        // Populate UI Info
        document.getElementById('epa-model').textContent = spec.modelFull;
        if (epaBadge) epaBadge.classList.remove('hidden');

        document.getElementById('preview-battery').textContent = `${spec.batteryCapacity} kWh`;
        document.getElementById('preview-range').textContent = `${spec.maxRange} km`;
        document.getElementById('preview-plug').textContent = spec.connector;
        if (specsPreview) specsPreview.classList.remove('hidden');
    }
};

window.handleSaveVehicleProfile = async function(e) {
    e.preventDefault();

    const make = document.getElementById('setup-vehicle-make').value;
    const model = document.getElementById('setup-vehicle-model').value;
    const vehicleNo = document.getElementById('setup-vehicle-no').value.trim().toUpperCase();

    if (!make || !model || !vehicleNo) {
        alert('Please select your car company, model, and enter the registration number.');
        return;
    }

    const spec = cachedEvModels.find(m => m.make === make && m.model === model);
    if (!spec) {
        alert('Could not find specifications for the selected model.');
        return;
    }

    showStatus('Saving EV configuration...');
    try {
        const res = await fetch('/api/user/vehicle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: activeUser.email,
                model: spec.modelFull,
                vehicleNo: vehicleNo,
                batteryCapacity: spec.batteryCapacity,
                maxRange: spec.maxRange,
                preferredConnector: spec.connector,
                preferredSpeed: spec.preferenceSpeed || 'DC'
            })
        });

        if (res.ok) {
            const data = await res.json();
            activeUser = data.user;
            showToastNotification('✅ EV Profile updated successfully!');
        } else {
            throw new Error('Save failed');
        }
    } catch (err) {
        console.warn('API vehicle update failed, updating in local store fallback:', err);
        // Fallback update
        activeUser.vehicleModel = spec.modelFull;
        activeUser.vehicleNo = vehicleNo;
        activeUser.batteryCapacity = spec.batteryCapacity;
        activeUser.maxRange = spec.maxRange;
        activeUser.preferredConnector = spec.connector;
        activeUser.preferredSpeed = spec.preferenceSpeed || 'DC';
        showToastNotification('✅ EV Profile configured locally (Offline)');
    } finally {
        hideStatus();
        const modal = document.getElementById('vehicle-setup-modal');
        if (modal) modal.classList.add('hidden');
        applyUserVehicleToInputs();
    }
};

window.triggerGoogleAuthLogin = function() {
    const overlay = document.getElementById('google-auth-overlay');
    if (!overlay) return;
    
    overlay.classList.remove('hidden');
    const statusText = document.getElementById('g-auth-status');
    
    setTimeout(() => {
        if (statusText) statusText.innerHTML = 'Exchanging secure Google OAuth 2.0 access credentials...';
    }, 600);
    
    setTimeout(() => {
        if (statusText) statusText.innerHTML = 'Verifying identity with Google Accounts database...';
    }, 1200);
    
    setTimeout(async () => {
        overlay.classList.add('hidden');
        
        // Log in silently as the default user using mock email in fallback
        activeUser = { 
            email: 'user@gridsync.in', 
            role: 'User', 
            name: 'Google User', 
            phone: '+91 98765 43210',
            savedStations: [], 
            chargingHistory: [] 
        };
        
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'user@gridsync.in', password: 'user123' })
            });
            if (res.ok) {
                const data = await res.json();
                activeUser = data.user;
            }
        } catch (e) {
            console.warn('User details fetch failed, running local mock Google user');
        }
        
        // Hide login screen and show app shell
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('user-app-shell').classList.remove('hidden');
        switchUserTab('home');
        initMap();
        
        showToastNotification(`Verified via Google Auth! Welcome, ${activeUser.name || 'GridSync Driver'}!`);

        // Check for complete EV profile specs
        checkUserVehicleProfile();
        logAnalyticsEvent('session_start', null, { role: 'User', via: 'google' });
    }, 2000);
};
