package com.extention.backend.repository;


import com.extention.backend.entity.QuizAttempt;
import org.springframework.data.jpa.repository.JpaRepository;

public interface QuizAttemptRepository extends JpaRepository<QuizAttempt, Long> {
}