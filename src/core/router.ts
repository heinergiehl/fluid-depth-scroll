import { parseRoute, pathOf, type Route } from "../markup"

// History API routing between the home flight and the project pages. Links marked `data-route`
// navigate without a reload (the scene plays a transition instead); every route also exists as a
// pre-rendered static page, so a reload or a shared link lands in the same place.

export class Router {
  route: Route
  private listeners: ((route: Route, from: Route) => void)[] = []

  constructor() {
    this.route = parseRoute(location.pathname)
    window.addEventListener("popstate", () => this.set(parseRoute(location.pathname)))
    document.addEventListener("click", e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-route]")
      if (!a || a.origin !== location.origin) return
      e.preventDefault()
      this.go(parseRoute(a.pathname))
    })
  }

  onChange(listener: (route: Route, from: Route) => void) {
    this.listeners.push(listener)
  }

  go(route: Route) {
    if (pathOf(route) === pathOf(this.route)) return
    history.pushState(null, "", pathOf(route))
    this.set(route)
  }

  private set(route: Route) {
    const from = this.route
    if (pathOf(route) === pathOf(from)) return
    this.route = route
    for (const l of this.listeners) l(route, from)
  }
}
