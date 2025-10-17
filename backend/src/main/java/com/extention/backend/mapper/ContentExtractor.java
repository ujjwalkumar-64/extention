package com.extention.backend.mapper;


import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;
import org.springframework.stereotype.Component;

@Component
public class ContentExtractor {

    public ExtractedContent extractFromUrl(String url) {
        try {
            Document doc = Jsoup.connect(url)
                    .userAgent("PageGenieBot/1.0 (+https://example.com)")
                    .timeout(12000)
                    .get();

            String title = doc.title();
            // Simple readable text approximation (you can swap for Boilerpipe/Readability)
            String text = Jsoup.clean(doc.body().text(), Safelist.none());
            return new ExtractedContent(title, text);
        } catch (Exception e) {
            throw new RuntimeException("Failed to fetch/extract content: " + e.getMessage(), e);
        }
    }

    public record ExtractedContent(String title, String text) {}
}