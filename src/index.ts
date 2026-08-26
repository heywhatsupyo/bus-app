import { findRoute, stopNames, type Route } from './routes.js';

const routes: Route[] = [
  {
    id: '96',
    name: 'Jurong East - Bedok',
    stops: [
      { id: '28009', name: 'Jurong East Int' },
      { id: '17009', name: 'Clementi Ave 6' },
      { id: '84009', name: 'Bedok Int' },
    ],
  },
];

const route = findRoute(routes, '96');
if (route) {
  console.log(`Route ${route.id}: ${stopNames(route).join(' -> ')}`);
}
