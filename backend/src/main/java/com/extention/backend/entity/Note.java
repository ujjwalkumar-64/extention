package com.extention.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

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

    // Original selected text; keep it moderate length or TEXT if needed
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) // maps to TEXT, avoids LOB stream
    @Column(columnDefinition = "TEXT")
    private String content;

    // Categories JSON from AI
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) // maps to TEXT, avoids LOB stream
    @Column(columnDefinition = "TEXT")
    private String categoriesJson;
    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;
}