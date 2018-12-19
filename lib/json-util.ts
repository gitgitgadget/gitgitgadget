import stringify from "json-stable-stringify";

export function fromJSON<T>(input: string): T {
    return JSON.parse(input) as T;
}

export function toJSON<T>(input: T): string {
    return stringify(input);
}

export function toPrettyJSON<T>(input: T): string {
    return stringify(input, { space: 4 });
}
