package com.extention.backend.response;

public class SearchItem {
    private String title;
    private String url;
    private String reason;

    public SearchItem() {}

    public SearchItem(String title, String url, String reason) {
        this.title = title;
        this.url = url;
        this.reason = reason;
    }

    public String getTitle() { return title; }
    public String getUrl() { return url; }
    public String getReason() { return reason; }

    public void setTitle(String title) { this.title = title; }
    public void setUrl(String url) { this.url = url; }
    public void setReason(String reason) { this.reason = reason; }
}