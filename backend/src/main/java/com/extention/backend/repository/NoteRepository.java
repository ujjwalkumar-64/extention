package com.extention.backend.repository;



import com.extention.backend.entity.Note;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NoteRepository extends JpaRepository<Note, Long> {
    List<Note> findByUsernameOrderByCreatedAtDesc(String username);
    List<Note> findTop3ByUsernameOrderByCreatedAtDesc(String username);
}