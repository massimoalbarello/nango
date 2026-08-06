export function errorName(error: unknown): string {
    return error instanceof Error ? error.name : typeof error;
}

export function headerNamesOnly(headers: unknown): Record<string, string> {
    if (!headers || typeof headers !== 'object') {
        return {};
    }
    const names: string[] = [];
    if (headers instanceof Headers) {
        headers.forEach((_value, name) => names.push(name));
    } else {
        names.push(...Object.keys(headers));
    }
    return Object.fromEntries(names.map((name) => [name, '<redacted>']));
}

export function sensitiveFields(value: unknown): { present: boolean; fieldNames: string[] } {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
        return { present: value != null, fieldNames: [] };
    }
    return { present: true, fieldNames: Object.keys(value) };
}

export function stripUrlQuery(url: string): string {
    const queryIndex = url.indexOf('?');
    const fragmentIndex = url.indexOf('#');
    const end = Math.min(queryIndex === -1 ? url.length : queryIndex, fragmentIndex === -1 ? url.length : fragmentIndex);
    return url.slice(0, end);
}

export function urlWithQueryParameterNames(url: string): string {
    const path = stripUrlQuery(url);
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) {
        return path;
    }

    const fragmentIndex = url.indexOf('#', queryIndex);
    const rawQuery = url.slice(queryIndex + 1, fragmentIndex === -1 ? url.length : fragmentIndex);
    if (!rawQuery) {
        return path;
    }

    try {
        const names = Array.from(new URLSearchParams(rawQuery).keys(), (name) => encodeURIComponent(name));
        return names.length > 0 ? `${path}?${names.join('&')}` : path;
    } catch {
        return path;
    }
}
