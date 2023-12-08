export function sleep(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
