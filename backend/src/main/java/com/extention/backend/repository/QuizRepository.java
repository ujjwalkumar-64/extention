package com.extention.backend.repository;


import com.extention.backend.entity.Quiz;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface QuizRepository extends JpaRepository<Quiz, Long> {
    List<Quiz> findByUsernameOrderByCreatedAtDesc(String username);
}