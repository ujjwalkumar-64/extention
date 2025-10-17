package com.extention.backend.service.serviceImpl;

import com.extention.backend.mapper.UserMapper;
import com.extention.backend.entity.User;
import com.extention.backend.repository.UserRepository;
import com.extention.backend.request.UserRequest;
import com.extention.backend.service.UserService;
import lombok.AllArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@AllArgsConstructor
public class UserServiceImpl  implements UserService {

    private UserRepository userRepository;
    private UserMapper userMapper;

    @Override
    public User createUser(UserRequest userRequest){
        PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
        String newPassword= passwordEncoder.encode(userRequest.password());

        return  userRepository.save(userMapper.toUser(userRequest,newPassword));
    }




    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        return userRepository.findByUsername(username)
                .orElseThrow(() -> new UsernameNotFoundException("User not found: " + username));
    }
}
