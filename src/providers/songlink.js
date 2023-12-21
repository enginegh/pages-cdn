import axios from "axios";
import { parse } from "node-html-parser";

class SongLink {
    constructor(baseUrl = "https://song.link") {
        this.baseUrl = baseUrl;
    }

    find_url(url) {
        return this._find(`${this.baseUrl}/${url}`);
    }

    async _find(url) {
        const resp = await axios.get(url);
        return this.parse(resp);
    }

    parse(resp) {
        const next_data = this.get_next_data(resp.data);

        const data = next_data?.props.pageProps?.pageData;
        if (!data) {
            if (next_data.page == "/not-found") {
                throw new Error(`No results found`);
            }
            throw new Error(`No page data found in response`);
        }

        const sections = data.sections.find(
            (s) => s.sectionId == "section|auto|links|listen",
        );
        const platforms = {};
        for (const link of sections.links) {
            if (link.uniqueId) {
                const [_, type, id] = link.uniqueId.split("|");
                platforms[link.platform] = {
                    url: link.url,
                    id,
                    type,
                };
            }
        }

        return {
            ...data.entityData,
            platforms,
        };
    }

    get_next_data(html) {
        const root = parse(html);
        const data = root.querySelector("#__NEXT_DATA__");
        if (!data) {
            throw new Error(`Nextjs data not found in response`);
        }
        return JSON.parse(data.innerText);
    }
}

export default SongLink;
