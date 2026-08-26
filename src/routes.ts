export interface Stop {
  id: string;
  name: string;
}

export interface Route {
  id: string;
  name: string;
  stops: Stop[];
}

/** Find a route by its id. Returns undefined when no route matches. */
export function findRoute(routes: Route[], id: string): Route | undefined {
  return routes.find((route) => route.id === id);
}

/** List the stop names for a route, in order. */
export function stopNames(route: Route): string[] {
  return route.stops.map((stop) => stop.name);
}
