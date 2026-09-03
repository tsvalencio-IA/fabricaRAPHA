import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { getLatLng } from './map-position.js';

const DESKTOP_BREAKPOINT = 1180;
const TABLET_BREAKPOINT = 760;

function fleetFitPadding(map) {
  const width = map.getSize().x;

  if (width >= DESKTOP_BREAKPOINT) {
    return {
      paddingTopLeft: [326, 86],
      paddingBottomRight: [428, 132]
    };
  }

  if (width >= TABLET_BREAKPOINT) {
    return {
      paddingTopLeft: [48, 82],
      paddingBottomRight: [48, 190]
    };
  }

  return {
    paddingTopLeft: [24, 76],
    paddingBottomRight: [24, 154]
  };
}

export default function MapViewportController({
  positions,
  fitEnabled = true,
  fitRequestKey = 0,
  focusedItem = null,
  singleZoom = 17,
  maxZoom = 17,
  fitPadding = null,
  onUserInteraction
}) {
  const map = useMap();
  const appliedFitRequestRef = useRef({ applied: false, key: null });
  const focusedDeviceRef = useRef(null);
  const interactionHandlerRef = useRef(onUserInteraction);
  const points = useMemo(
    () => (Array.isArray(positions) ? positions.map(getLatLng).filter(Boolean) : []),
    [positions]
  );

  useEffect(() => {
    interactionHandlerRef.current = onUserInteraction;
  }, [onUserInteraction]);

  useEffect(() => {
    if (!fitEnabled || points.length === 0) return;

    const lastRequest = appliedFitRequestRef.current;
    if (lastRequest.applied && Object.is(lastRequest.key, fitRequestKey)) return;
    appliedFitRequestRef.current = { applied: true, key: fitRequestKey };

    if (points.length === 1) {
      map.flyTo(points[0], singleZoom, { animate: true, duration: 0.55 });
      return;
    }

    // fitBounds ja escolhe o zoom que mantem toda a frota visivel. Forcar um
    // zoom minimo depois disso coloca a camera no centro geografico vazio.
    map.fitBounds(points, {
      ...(fitPadding ? { padding: fitPadding } : fleetFitPadding(map)),
      maxZoom,
      animate: false
    });
  }, [fitEnabled, fitPadding, fitRequestKey, map, maxZoom, points, singleZoom]);

  const focusedDeviceId = Number(focusedItem?.device?.id) || null;
  const focusedLatLng = getLatLng(focusedItem?.position);
  const focusedLatitude = focusedLatLng?.[0] ?? null;
  const focusedLongitude = focusedLatLng?.[1] ?? null;

  useEffect(() => {
    if (!focusedDeviceId || focusedLatitude === null || focusedLongitude === null) {
      focusedDeviceRef.current = null;
      return;
    }

    if (focusedDeviceRef.current === focusedDeviceId) return;
    focusedDeviceRef.current = focusedDeviceId;
    map.flyTo([focusedLatitude, focusedLongitude], 18, { animate: true, duration: 0.6 });
  }, [focusedDeviceId, focusedLatitude, focusedLongitude, map]);

  useEffect(() => {
    const container = map.getContainer();
    const notifyUserInteraction = () => interactionHandlerRef.current?.();
    const interactionEvents = ['pointerdown', 'wheel', 'touchstart'];

    interactionEvents.forEach((eventName) => {
      container.addEventListener(eventName, notifyUserInteraction, { passive: true });
    });

    return () => {
      interactionEvents.forEach((eventName) => {
        container.removeEventListener(eventName, notifyUserInteraction);
      });
    };
  }, [map]);

  useEffect(() => {
    const container = map.getContainer();
    if (typeof ResizeObserver !== 'function') return undefined;

    let animationFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [map]);

  return null;
}
