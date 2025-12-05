// frontend/js/delivery-map.js
// Leaflet live map for delivery partner - shows your current location and sends to server

const MAP_START_LAT = 17.3850; // default center (change if you want)
const MAP_START_LNG = 78.4867;
const MAP_START_ZOOM = 13;
const LOCATION_UPDATE_INTERVAL = 10000; // ms

let map = null;
let partnerMarker = null;
let destinationMarker = null;
let watchId = null;

// token helper (matches your other frontend helpers)
function getTokenForMap() {
  return localStorage.getItem('authToken') || localStorage.getItem('token') || null;
}

/* helper: wait for Leaflet global `L` to be available (avoids race with CDN load) */
function waitForLeaflet(timeout = 4000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.L) return resolve(window.L);
      if (Date.now() - start > timeout) return reject(new Error('Leaflet not available'));
      setTimeout(check, 50);
    })();
  });
}

// initialize map and start tracking
async function initDeliveryMap() {
  try {
    // wait for Leaflet to load (avoids "L is not defined")
    await waitForLeaflet(4000);
  } catch (err) {
    console.error('Leaflet library not available:', err);
    return;
  }

  const el = document.getElementById('deliveryMap');
  if (!el) {
    console.warn('deliveryMap element not found.');
    return;
  }

  // If there is already a map instance, remove it first (prevents "container already initialized" error)
  try {
    if (map) {
      try { map.remove(); } catch (e) { /* ignore removal error */ }
      map = null;
      partnerMarker = null;
      destinationMarker = null;
      // don't reference map after nullifying it
    }
  } catch (err) {
    console.warn('Error removing existing map (continuing):', err);
  }

  // create map safely
  try {
    map = L.map('deliveryMap', { zoomControl: true }).setView([MAP_START_LAT, MAP_START_LNG], MAP_START_ZOOM);

    // add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // add partner marker
    partnerMarker = L.marker([MAP_START_LAT, MAP_START_LNG], { title: 'You (delivery partner)' }).addTo(map);
    partnerMarker.bindPopup('Your location');

    // show order destination if available (guarded)
    try {
      if (window.assignedOrders && window.assignedOrders.length) {
        const o = window.assignedOrders[0];
        if (o && o.deliveryLocation && Array.isArray(o.deliveryLocation.coordinates) && o.deliveryLocation.coordinates.length >= 2) {
          const lng = o.deliveryLocation.coordinates[0];
          const lat = o.deliveryLocation.coordinates[1];
          setDestinationMarker(lat, lng, o);
        }
      }
    } catch (e) {
      console.warn('Could not set initial destination marker', e);
    }

    // start tracking
    startLocationTracking();
    console.log('Leaflet map initialized');
  } catch (err) {
    console.error('Failed to initialize Leaflet map:', err);
  }
}

function setDestinationMarker(lat, lng, order) {
  if (!map) return;
  if (destinationMarker) {
    destinationMarker.setLatLng([lat, lng]);
    destinationMarker.setPopupContent(order?.restaurant?.name || 'Destination');
  } else {
    destinationMarker = L.marker([lat, lng])
      .addTo(map)
      .bindPopup(order?.restaurant?.name || 'Destination');
  }
}

function updatePartnerMarker(lat, lng) {
  if (!map) return;
  if (!partnerMarker) {
    partnerMarker = L.marker([lat, lng], { title: 'You (delivery partner)' }).addTo(map);
    partnerMarker.bindPopup('You (delivery partner)').openPopup();
  } else {
    partnerMarker.setLatLng([lat, lng]);
    partnerMarker.bindPopup('You (delivery partner)').openPopup();
  }
}

// send location to backend
async function sendLocationToServer(lat, lng) {
  const token = getTokenForMap();
  if (!token) {
    console.warn('No token to send location.');
    return;
  }
  try {
    const res = await fetch('http://localhost:5000/api/delivery/location', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ lat: Number(lat), lng: Number(lng) })
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('Location update failed:', res.status, txt);
    }
  } catch (err) {
    console.error('Failed to send location:', err);
  }
}

function startLocationTracking() {
  if (!('geolocation' in navigator)) {
    console.warn('Geolocation not supported by this browser.');
    return;
  }

  // clear existing
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  const options = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 };

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      updatePartnerMarker(lat, lng);

      // center map on partner the first time (or if zoom level small)
      try {
        if (map && (map._justCentered !== true)) {
          map.setView([lat, lng], 15);
          map._justCentered = true;
        }
      } catch (e) { /* ignore */ }

      // throttle sends
      const now = Date.now();
      if (!startLocationTracking._lastSent || (now - startLocationTracking._lastSent) > LOCATION_UPDATE_INTERVAL) {
        startLocationTracking._lastSent = now;
        await sendLocationToServer(lat, lng);
      }
    },
    (err) => {
      console.warn('Geolocation watchPosition error:', err);
    },
    options
  );
}

function stopLocationTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// auto-init: small delay but map init will still wait for L via waitForLeaflet()
// (Note: you can instead call initDeliveryMap() after your assignedOrders are loaded)
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    try { initDeliveryMap(); } catch (e) { console.error('initDeliveryMap error', e); }
  }, 200);
});

// expose for debug
window.initDeliveryMap = initDeliveryMap;
window.startLocationTracking = startLocationTracking;
window.stopLocationTracking = stopLocationTracking;
window.setDestinationMarker = setDestinationMarker;
