package com.extention.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "notes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Note {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String username; // owner

    @Column(length = 1024)
    private String sourceUrl;

    @Lob
    @Column(nullable = false)
    private String content; // selected text

    // JSON string: {"topic":"..","relatedTo":[".."],"tags":[".."],"summary":".."}
    @Lob
    private String categoriesJson;

    @CreationTimestamp
    private Instant createdAt;
}