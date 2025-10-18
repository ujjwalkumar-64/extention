package com.extention.backend.repository;



import com.extention.backend.entity.Suggestion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SuggestionRepository extends JpaRepository<Suggestion, Long> {
    List<Suggestion> findTop10ByUsernameOrderByCreatedAtDesc(String username);
    List<Suggestion> findTop2ByUsernameOrderByCreatedAtDesc(String username);
}