package com.extention.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "quizzes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Quiz {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String username; // owner

    @Column(length = 1024)
    private String sourceUrl;

    @Column(length = 512)
    private String articleTitle;

    // JSON string:
    // {"questions":[{"question":"...","options":["A","B","C","D"],"correctIndex":1,"explanation":"..."}]}
    @Lob
    @Column(nullable = false)
    private String questionsJson;

    @CreationTimestamp
    private Instant createdAt;
}