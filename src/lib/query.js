export function getQueryFromMetadata(track) {
    const parsedTitle = track.name
        .replace(
            /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu,
            "",
        )
        .trim();

    let query = parsedTitle;

    if (track.artists.length > 0) {
        const artists = track.artists.map((artist) => artist.name).join(" ");
        query = artists ? `${query} ${artists}` : query;
    } else if (track.album) {
        const album = track.album.name;
        query = album ? `${query} ${album}` : query;
    }

    return query;
}
