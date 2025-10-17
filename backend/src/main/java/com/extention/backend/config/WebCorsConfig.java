package com.extention.backend.config;


import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebCorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                // For extensions, requests originate from chrome-extension://<id>. Using patterns is simpler.
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "Authorization", "Accept")
                .exposedHeaders("Content-Type")
                .exposedHeaders("Authorization", "Content-Type")
                // Service worker requests typically don't send cookies; keeping credentials false is fine.
                .allowCredentials(true)
                .maxAge(3600);
    }
}