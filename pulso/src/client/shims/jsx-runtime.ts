// Solo para el build demo de una página: React llega como global desde el CDN (build UMD), que no
// trae `react/jsx-runtime`. Estas tres funciones traducen el JSX automático a React.createElement.
import * as React from 'react';

type Props = Record<string, unknown> & { children?: unknown };

export function jsx(type: React.ElementType, props: Props, key?: React.Key) {
  const { children, ...rest } = props;
  if (key !== undefined) (rest as Props).key = key;
  return children === undefined
    ? React.createElement(type, rest)
    : Array.isArray(children)
      ? React.createElement(type, rest, ...children)
      : React.createElement(type, rest, children as React.ReactNode);
}

export const jsxs = jsx;
export const Fragment = React.Fragment;
