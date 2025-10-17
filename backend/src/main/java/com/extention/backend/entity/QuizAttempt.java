package com.extention.backend.entity;


import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

@Entity
@Table(name = "quiz_attempts")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class QuizAttempt {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    private Quiz quiz;

    @Column(nullable = false)
    private String username;

    private int score; // 0..questionsCount

    // JSON: {"answers":[1,0,2,...],"correct":[1,3,0,...]}
    @Lob
    private String answersJson;

    @CreationTimestamp
    private Instant createdAt;
}