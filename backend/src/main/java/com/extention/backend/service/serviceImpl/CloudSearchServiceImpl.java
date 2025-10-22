package com.extention.backend.service.serviceImpl;

import com.extention.backend.response.SearchItem;
import com.extention.backend.service.CloudSearchService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class CloudSearchServiceImpl implements CloudSearchService {
    private final RestClient http;
    private final String apiKey;
    private final String cx;

    public CloudSearchServiceImpl(
            @Value("${application.config.GOOGLE_CSE_API_KEY}") String apiKey,
            @Value("${application.config.GOOGLE_CSE_CX}") String cx
    ) {
        this.http = RestClient.create();
        this.apiKey = apiKey;
        this.cx = cx;
    }

    @Override
    public List<SearchItem> findSources(String text, String sourceUrl, String persona, int size) {
        if (!StringUtils.hasText(apiKey) || !StringUtils.hasText(cx)) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Search not configured");
        }

        final int limit = Math.max(1, Math.min(size, 10));
        final String host = normalizeDomain(sourceUrl);
        final String subject = extractSubjectFromUrl(sourceUrl); // e.g., "Virat Kohli"
        final QueryPlan plan = buildQueryPlan(text, subject, host);

        LinkedHashMap<String, SearchItem> dedup = new LinkedHashMap<>();

        for (String q : plan.attempts) {
            if (!StringUtils.hasText(q)) continue;

            Map<?, ?> body;
            try {
                body = http.get()
                        .uri(buildUrl(q, limit, plan.lang, plan.region))
                        .retrieve()
                        .body(Map.class);
            } catch (Exception ex) {
                // Continue to next attempt on per-request failures
                continue;
            }

            List<?> items = Collections.emptyList();
            if (body != null) {
                Object obj = body.get("items");
                if (obj instanceof List<?>) {
                    items = (List<?>) obj;
                }
            }

            mapAndDedup(items, dedup);

            if (dedup.size() >= limit) break; // enough results
        }

        // If still empty, try the first sentence as a last resort (with and without site exclusion)
        if (dedup.isEmpty()) {
            String first = firstSentence(text);
            for (String q : Arrays.asList(
                    safeJoin(subject, first, excludeSite(host)),
                    safeJoin(subject, first)
            )) {
                if (!StringUtils.hasText(q)) continue;

                Map<?, ?> body;
                try {
                    body = http.get()
                            .uri(buildUrl(q, limit, plan.lang, plan.region))
                            .retrieve()
                            .body(Map.class);
                } catch (Exception ex) {
                    continue;
                }

                List<?> items = Collections.emptyList();
                if (body != null) {
                    Object obj = body.get("items");
                    if (obj instanceof List<?>) {
                        items = (List<?>) obj;
                    }
                }
                mapAndDedup(items, dedup);
                if (dedup.size() >= limit) break;
            }
        }

        return dedup.values().stream().limit(limit).collect(Collectors.toList());
    }

    // ---------- helpers ----------

    // Use injected apiKey and cx instead of System properties
    private String buildUrl(String query, int num, String lang, String region) {
        StringBuilder sb = new StringBuilder("https://www.googleapis.com/customsearch/v1");
        sb.append("?key=").append(urlEnc(apiKey));
        sb.append("&cx=").append(urlEnc(cx));
        sb.append("&q=").append(urlEnc(query));
        sb.append("&num=").append(num);
        if (StringUtils.hasText(lang)) sb.append("&lr=").append(urlEnc("lang_" + lang)); // e.g., lang_en
        if (StringUtils.hasText(region)) sb.append("&gl=").append(urlEnc(region));       // e.g., IN, US
        return sb.toString();
    }

    private static String urlEnc(String s) { return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8); }
    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    private static void mapAndDedup(List<?> items, LinkedHashMap<String, SearchItem> dedup) {
        for (Object it : items) {
            if (!(it instanceof Map)) continue;
            Map<?, ?> m = (Map<?, ?>) it;
            String title = str(m.get("title"));
            String link = str(m.get("link"));
            String snippet = str(m.get("snippet"));
            if (!StringUtils.hasText(link) || !StringUtils.hasText(title)) continue;

            String domain = normalizeDomain(link);
            String titleKey = normalizeTitleForKey(title);
            String key = domain + "|" + titleKey;
            if (dedup.containsKey(key)) continue;

            String reason = buildReason(snippet);
            dedup.put(key, new SearchItem(title, link, reason));
        }
    }

    private static String normalizeDomain(String url) {
        if (!StringUtils.hasText(url)) return "";
        try {
            URI uri = new URI(url);
            String host = Optional.ofNullable(uri.getHost()).orElse("");
            if (host.startsWith("www.")) host = host.substring(4);
            return host.toLowerCase(Locale.ROOT);
        } catch (URISyntaxException e) {
            return "";
        }
    }

    private static String normalizeTitleForKey(String title) {
        String t = title.trim().toLowerCase(Locale.ROOT);
        // trim trailing site suffix: " - ESPNcricinfo", " | The Hindu"
        t = t.replaceAll("\\s+[-|•–—]\\s+.*$", "");
        return t;
    }

    private static String buildReason(String snippet) {
        String s = snippet == null ? "" : snippet.trim();
        if (s.length() > 180) s = s.substring(0, 177) + "...";
        return StringUtils.hasText(s) ? (s + " — found by search") : "found by search";
    }

    private static String excludeSite(String host) {
        return StringUtils.hasText(host) ? ("-site:" + host) : "";
    }

    private static String safeJoin(String... parts) {
        return Arrays.stream(parts).filter(StringUtils::hasText).collect(Collectors.joining(" "));
    }

    // Build a better query plan from text + subject + host
    private static QueryPlan buildQueryPlan(String text, String subject, String host) {
        String first = firstSentence(text);
        String lang = guessLang(text);   // "en" best-effort
        String region = guessRegion(text); // e.g., "IN" for Indian topics

        // Extract key tokens from the biographical claim
        ClaimTokens t = extractClaimTokens(text, subject);

        List<String> attempts = new ArrayList<>(8);
        // 1) Entity-focused with site exclusion
        attempts.add(safeJoin(subject, t.core, t.when, t.where, excludeSite(host)));
        // 2) Same without site exclusion (if #1 yields none)
        attempts.add(safeJoin(subject, t.core, t.when, t.where));
        // 3) Biography fallback
        attempts.add(safeJoin(subject, "biography", excludeSite(host)));
        attempts.add(safeJoin(subject, "biography"));
        // 4) First sentence with subject
        attempts.add(safeJoin(subject, first, excludeSite(host)));
        attempts.add(safeJoin(subject, first));

        // Deduplicate empty or identical attempts
        LinkedHashSet<String> uniq = new LinkedHashSet<>();
        for (String q : attempts) {
            if (StringUtils.hasText(q)) uniq.add(q.trim());
        }

        QueryPlan plan = new QueryPlan();
        plan.attempts = new ArrayList<>(uniq);
        plan.lang = lang;
        plan.region = region;
        return plan;
    }

    private static String extractSubjectFromUrl(String sourceUrl) {
        if (!StringUtils.hasText(sourceUrl)) return "";
        try {
            URI uri = new URI(sourceUrl);
            String path = Optional.ofNullable(uri.getPath()).orElse("");
            if (path.contains("/wiki/")) {
                String slug = path.substring(path.lastIndexOf('/') + 1);
                slug = URLDecoder.decode(slug, StandardCharsets.UTF_8);
                slug = slug.replace('_', ' ').trim();
                if (slug.length() >= 3) return decodeCase(slug);
            }
            // Fallback: last path segment
            String last = path.substring(path.lastIndexOf('/') + 1);
            if (StringUtils.hasText(last)) {
                last = URLDecoder.decode(last, StandardCharsets.UTF_8);
                return decodeCase(last.replace('-', ' ').replace('_', ' '));
            }
        } catch (Exception ignored) {}
        return "";
    }

    private static String decodeCase(String s) {
        if (!StringUtils.hasText(s)) return s;
        // Title case each word
        StringBuilder b = new StringBuilder();
        for (String w : s.split("\\s+")) {
            if (w.isEmpty()) continue;
            b.append(Character.toUpperCase(w.charAt(0)));
            if (w.length() > 1) b.append(w.substring(1));
            b.append(' ');
        }
        return b.toString().trim();
    }

    private static String firstSentence(String text) {
        if (!StringUtils.hasText(text)) return "";
        String s = text.strip();
        int dot = s.indexOf('.');
        if (dot >= 0 && dot < 400) return s.substring(0, dot + 1);
        return s.length() > 400 ? s.substring(0, 400) : s;
    }

    private static String guessLang(String text) {
        // Heuristic: default English
        String t = (text == null ? "" : text.toLowerCase(Locale.ROOT));
        if (t.matches(".*\\b(january|february|march|april|may|june|july|august|september|october|november|december)\\b.*")) return "en";
        return "en";
    }

    private static String guessRegion(String text) {
        String t = (text == null ? "" : text.toLowerCase(Locale.ROOT));
        if (t.contains("delhi") || t.contains("india") || t.contains("punjabi")) return "IN";
        return "";
    }

    private static ClaimTokens extractClaimTokens(String text, String subject) {
        ClaimTokens ct = new ClaimTokens();
        if (!StringUtils.hasText(text)) return ct;

        String t = text;

        // WHEN: years (1800..2099)
        var years = new ArrayList<String>();
        var yMatcher = Pattern.compile("\\b(18\\d{2}|19\\d{2}|20\\d{2})\\b").matcher(t);
        while (yMatcher.find()) years.add(yMatcher.group(1));
        if (!years.isEmpty()) ct.when = String.join(" ", years);

        // WHERE: simple proper nouns like Delhi, Mumbai, Bengaluru (capitalized words excluding subject tokens)
        var where = new LinkedHashSet<String>();
        var capMatcher = Pattern.compile("\\b([A-Z][a-zA-Z]+)\\b").matcher(t);
        String subjectLower = subject == null ? "" : subject.toLowerCase(Locale.ROOT);
        while (capMatcher.find()) {
            String w = capMatcher.group(1);
            if (subjectLower.contains(w.toLowerCase(Locale.ROOT))) continue;
            where.add(w);
            if (where.size() >= 5) break; // cap noise
        }
        if (!where.isEmpty()) ct.where = String.join(" ", where);

        // CORE: simple hint words
        String lower = t.toLowerCase(Locale.ROOT);
        if (lower.contains("born")) ct.core = "born";
        else if (lower.contains("captain")) ct.core = "captain";
        else if (lower.contains("cricketer")) ct.core = "cricketer";
        else ct.core = "";

        return ct;
    }

    private static class QueryPlan {
        List<String> attempts;
        String lang;
        String region;
    }
    private static class ClaimTokens {
        String core = "";
        String when = "";
        String where = "";
    }
}