import stringify from "json-stable-stringify";

export function fromJSON<T>(input: string): T {
    return JSON.parse(input) as T;
}

export function toJSON<T>(input: T): string {
    const result = stringify(input);
    if (typeof result !== "string") throw new Error(`Could not convert ${input} to JSON`);
    return result;
}

export function toPrettyJSON<T>(input: T): string {
    const result = stringify(input, { space: 4 });
    if (typeof result !== "string") throw new Error(`Could not convert ${input} to JSON`);
    return result;
}
