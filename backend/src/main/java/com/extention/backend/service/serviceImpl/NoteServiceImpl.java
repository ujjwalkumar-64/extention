package com.extention.backend.service.serviceImpl;

 

import com.extention.backend.entity.Note;
import com.extention.backend.repository.NoteRepository;
import com.extention.backend.service.AiService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class NoteServiceImpl {
    private final NoteRepository noteRepository;
    @Qualifier("aiServiceImpl")
    private final AiService ai;
    private final ObjectMapper mapper = new ObjectMapper();

    @Transactional
    public Note saveCategorized(String username, String sourceUrl, String content) {
        String json = ai.categorizeNoteJson(content);
        Note note = Note.builder()
                .username(username)
                .sourceUrl(sourceUrl)
                .content(content)
                .categoriesJson(json)
                .build();
        return noteRepository.save(note);
    }

    public List<Note> list(String username) {
        return noteRepository.findByUsernameOrderByCreatedAtDesc(username);
    }
}
