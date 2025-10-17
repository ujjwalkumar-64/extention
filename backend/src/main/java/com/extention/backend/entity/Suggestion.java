package com.extention.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "suggestions")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Suggestion {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String username;

    @Column(length = 1024)
    private String baseSourceUrl;

    @Column(length = 1024)
    private String suggestedUrl;

    @Column(length = 512)
    private String title;

    // Reason from AI: "Read this next because ..."
    @Lob
    private String reason;

    @CreationTimestamp
    private Instant createdAt;
}