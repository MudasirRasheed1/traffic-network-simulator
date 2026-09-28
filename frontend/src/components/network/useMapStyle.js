import { useState } from 'react';

const KEY = 'urbangrid-map-style';

// Dark or light base map, remembered in this browser.
export function useMapStyle() {
  const [style, setStyle] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const update = (next) => {
    setStyle(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // preference just won't be remembered
    }
  };
  return [style, update];
}

export const MAP_STYLES = { dark: 'Dark', light: 'Light' };
